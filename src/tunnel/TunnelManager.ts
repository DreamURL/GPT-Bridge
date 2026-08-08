import { spawn, type ChildProcess } from 'node:child_process';

/**
 * cloudflared 프로세스 관리 (project.md §6).
 *
 * vscode에 의존하지 않는다. URL 파싱과 백오프 계산은 순수 함수로 분리해
 * 확장 호스트 없이 테스트한다.
 */

const QUICK_TUNNEL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** cloudflared 로그는 stdout이 아니라 stderr로 나온다. 양쪽 모두 훑는다. */
export function parseQuickTunnelUrl(chunk: string): string | undefined {
  const match = QUICK_TUNNEL_PATTERN.exec(chunk);
  return match?.[0];
}

/** 지수 백오프: 2초, 4초, 8초. */
export function backoffDelayMs(attempt: number): number {
  return 2_000 * 2 ** Math.max(0, attempt);
}

export const MAX_RESTART_ATTEMPTS = 3;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const URL_WAIT_TIMEOUT_MS = 60_000;
const SIGKILL_DELAY_MS = 5_000;

export type TunnelStatus = 'stopped' | 'starting' | 'connected' | 'failed';

export interface TunnelLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TunnelOptions {
  readonly binPath: string;
  readonly localPort: number;
  /** Named Tunnel 토큰. 있으면 고정 도메인 모드로 실행한다. */
  readonly token: string | undefined;
  /** Named Tunnel의 공개 호스트명. 토큰만으로는 알아낼 수 없어 사용자가 지정한다. */
  readonly hostname: string | undefined;
  readonly log: TunnelLogger;
  readonly onStatus: (status: TunnelStatus, url: string | undefined, message?: string) => void;
}

export class TunnelManager {
  private child: ChildProcess | undefined;
  private healthTimer: NodeJS.Timeout | undefined;
  private url: string | undefined;
  private restartCount = 0;
  private stopping = false;

  constructor(private readonly options: TunnelOptions) {}

  get publicUrl(): string | undefined {
    return this.url;
  }

  get isRunning(): boolean {
    return this.child !== undefined;
  }

  async start(): Promise<string | undefined> {
    if (this.child !== undefined) {
      return this.url;
    }
    this.stopping = false;
    this.restartCount = 0;
    return this.spawnOnce();
  }

  private buildArgs(): string[] {
    if (this.options.token !== undefined && this.options.token.length > 0) {
      // Named Tunnel: 인그레스 설정은 Cloudflare 대시보드 쪽에 있다.
      return ['tunnel', 'run', '--token', this.options.token];
    }
    // Quick Tunnel: 실행할 때마다 URL이 바뀐다.
    return ['tunnel', '--url', `http://127.0.0.1:${this.options.localPort}`];
  }

  private async spawnOnce(): Promise<string | undefined> {
    this.options.onStatus('starting', undefined);

    const args = this.buildArgs();
    const child = spawn(this.options.binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;

    const named = this.options.token !== undefined && this.options.token.length > 0;

    const urlPromise = named
      ? Promise.resolve(this.options.hostname === undefined ? undefined : normalizeUrl(this.options.hostname))
      : this.waitForQuickTunnelUrl(child);

    const scan = (data: Buffer): void => {
      const text = data.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim().length > 0) {
          this.options.log.info(`[cloudflared] ${line.trim()}`);
        }
      }
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);

    child.on('exit', (code, signal) => {
      this.child = undefined;
      this.clearHealthTimer();

      if (this.stopping) {
        this.options.onStatus('stopped', undefined);
        return;
      }

      this.options.log.warn(`cloudflared exited (code=${code}, signal=${signal})`);
      void this.restart();
    });

    child.on('error', (error) => {
      this.options.log.error(`Failed to run cloudflared: ${error.message}`);
      this.child = undefined;
      this.options.onStatus('failed', undefined, error.message);
    });

    const url = await urlPromise;
    this.url = url;

    if (url === undefined && !named) {
      this.options.log.warn('Could not find the tunnel URL.');
      this.options.onStatus('failed', undefined, 'Could not determine the tunnel URL');
      return undefined;
    }

    this.options.onStatus(
      'connected',
      url,
      url === undefined
        ? 'A Named Tunnel is running. Set the public hostname in gptBridge.tunnel.hostname.'
        : undefined
    );
    this.startHealthChecks();
    return url;
  }

  /** stdout·stderr에서 trycloudflare.com URL이 나올 때까지 기다린다. */
  private waitForQuickTunnelUrl(child: ChildProcess): Promise<string | undefined> {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (value: string | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        resolve(value);
      };

      const onData = (data: Buffer): void => {
        const found = parseQuickTunnelUrl(data.toString('utf8'));
        if (found !== undefined) {
          finish(found);
        }
      };

      const timer = setTimeout(() => finish(undefined), URL_WAIT_TIMEOUT_MS);

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('exit', () => finish(undefined));
    });
  }

  private startHealthChecks(): void {
    this.clearHealthTimer();
    this.healthTimer = setInterval(() => {
      void this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private clearHealthTimer(): void {
    if (this.healthTimer !== undefined) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  /**
   * 터널을 통해 로컬 /health를 찔러 본다.
   * URL을 모르는 Named Tunnel은 프로세스 생존 여부로 대신한다.
   */
  private async checkHealth(): Promise<void> {
    if (this.url === undefined) {
      if (this.child === undefined && !this.stopping) {
        void this.restart();
      }
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.url}/health`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.restartCount = 0;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.options.log.warn(`Tunnel health check failed: ${reason}`);
      await this.restart();
    } finally {
      clearTimeout(timer);
    }
  }

  private async restart(): Promise<void> {
    if (this.stopping) {
      return;
    }
    if (this.restartCount >= MAX_RESTART_ATTEMPTS) {
      this.options.log.error(
        `Tried restarting the tunnel ${MAX_RESTART_ATTEMPTS} times without success. Giving up on auto-restart.`
      );
      this.options.onStatus('failed', undefined, 'The tunnel failed to restart repeatedly');
      return;
    }

    const delay = backoffDelayMs(this.restartCount);
    this.restartCount += 1;
    this.options.log.warn(
      `Restarting the tunnel in ${delay / 1000}s (${this.restartCount}/${MAX_RESTART_ATTEMPTS})`
    );

    await this.killChild();
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.stopping) {
      return;
    }
    await this.spawnOnce();
  }

  /**
   * SIGTERM 후 5초 뒤 SIGKILL (project.md §6).
   * 확장 호스트 리로드 시 좀비 프로세스가 남으면 포트가 계속 물린다.
   *
   * Windows에는 시그널이 없다. Node의 kill()은 TerminateProcess로 매핑되어
   * **해당 프로세스만** 죽이고 자식 프로세스는 그대로 남는다. cloudflared가
   * 자식을 띄우는 경우 좀비가 남으므로 `taskkill /T`로 트리째 정리한다.
   */
  private killChild(): Promise<void> {
    const child = this.child;
    if (child === undefined || child.exitCode !== null) {
      this.child = undefined;
      return Promise.resolve();
    }

    this.child = undefined;

    if (process.platform === 'win32') {
      return this.killProcessTreeWindows(child);
    }

    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(killTimer);
        resolve();
      };

      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          this.options.log.warn('cloudflared did not respond to SIGTERM - sending SIGKILL.');
          child.kill('SIGKILL');
        }
        resolve();
      }, SIGKILL_DELAY_MS);

      child.once('exit', done);
      child.kill('SIGTERM');
    });
  }

  private killProcessTreeWindows(child: ChildProcess): Promise<void> {
    const pid = child.pid;
    if (pid === undefined) {
      child.kill();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const settle = (): void => {
        clearTimeout(fallbackTimer);
        resolve();
      };

      // taskkill이 응답하지 않아도 무한정 기다리지 않는다.
      const fallbackTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill();
        }
        resolve();
      }, SIGKILL_DELAY_MS);

      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });

      killer.on('error', (error) => {
        this.options.log.warn(`taskkill failed: ${error.message}. Falling back to a direct kill.`);
        child.kill();
        settle();
      });

      killer.on('exit', () => {
        this.options.log.info(`Terminated the cloudflared process tree (pid ${pid})`);
        settle();
      });
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearHealthTimer();
    await this.killChild();
    this.url = undefined;
    this.options.onStatus('stopped', undefined);
  }
}

/** 사용자가 넣은 호스트명을 https URL로 정규화한다. */
export function normalizeUrl(hostname: string): string {
  const trimmed = hostname.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return trimmed;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
