import * as vscode from 'vscode';
import { readConfig, type BridgeConfig } from '../config';
import type { SecretStore } from '../secrets';
import type { BridgeStateStore } from '../state';
import { PathGuard } from '../workspace/PathGuard';
import { Ripgrep, resolveRgPath } from '../workspace/ripgrep';
import { McpHttpServer, MCP_ENDPOINT, PortInUseError } from './http';
import { createConfiguredServer } from './registry';
import type { ActivityEntry, ToolContext } from './tools/types';

export interface BridgeServerDeps {
  readonly log: vscode.LogOutputChannel;
  readonly store: BridgeStateStore;
  readonly secrets: SecretStore;
  readonly extensionPath: string;
  readonly onActivity: (entry: ActivityEntry) => void;
}

/**
 * MCP 서버 생명주기. 확장 쪽 관심사(워크스페이스, 설정, 상태, 알림)를
 * vscode 비의존 계층(McpHttpServer)에 연결한다.
 */
export class BridgeServer implements vscode.Disposable {
  private http: McpHttpServer | undefined;
  private token: string | undefined;
  private starting = false;

  constructor(private readonly deps: BridgeServerDeps) {}

  get isRunning(): boolean {
    return this.http?.isRunning === true;
  }

  get port(): number | undefined {
    return this.http?.port;
  }

  async start(): Promise<void> {
    if (this.isRunning || this.starting) {
      this.deps.log.info('서버가 이미 실행 중입니다');
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      const message = '열린 워크스페이스 폴더가 없습니다. 폴더를 먼저 여세요.';
      this.deps.store.update({ status: 'error', message });
      void vscode.window.showErrorMessage(`GPT Bridge: ${message}`);
      return;
    }

    this.starting = true;
    this.deps.store.update({ status: 'starting', message: undefined });

    try {
      const config = readConfig();
      const guard = new PathGuard({
        root: folder.uri.fsPath,
        extraDenyPatterns: config.denyExtraPatterns
      });
      const root = await guard.realRoot();

      const rgPath = resolveRgPath(this.deps.extensionPath);
      if (rgPath === undefined) {
        this.deps.log.warn(
          'ripgrep 바이너리를 찾지 못했습니다. list_directory / search_text가 비활성화됩니다.'
        );
        void vscode.window.showWarningMessage(
          'GPT Bridge: ripgrep을 찾지 못해 파일 목록·검색 툴이 비활성화됩니다.'
        );
      } else {
        this.deps.log.info(`ripgrep: ${rgPath}`);
      }

      const ctx: ToolContext = {
        guard,
        root,
        config: (): BridgeConfig => readConfig(),
        log: this.deps.log,
        rg: rgPath === undefined ? undefined : new Ripgrep(rgPath),
        onBlocked: (tool, reason, requestedPath) => {
          // 차단된 접근 시도는 조용히 실패시키지 않는다 (project.md §5.5).
          this.deps.log.warn(`차단됨 — ${tool}(${requestedPath}): ${reason}`);
          void vscode.window.showWarningMessage(
            `GPT Bridge: 차단된 접근 시도 — ${tool} "${requestedPath}" (${reason})`
          );
        },
        onActivity: this.deps.onActivity
      };

      this.token = await this.deps.secrets.ensureAuthToken();

      const http = new McpHttpServer({
        port: config.port,
        getToken: () => this.token,
        createServer: () => createConfiguredServer(ctx),
        log: {
          info: (message) => this.deps.log.info(message),
          warn: (message) => this.deps.log.warn(message),
          error: (message) => this.deps.log.error(message)
        },
        onAuthFailure: (reason, remoteAddress) => {
          this.deps.log.warn(`인증 실패 (${reason}) — ${remoteAddress ?? '주소 불명'}`);
        }
      });

      const port = await http.start();
      this.http = http;
      this.deps.store.update({ status: 'running', port, message: undefined });
      this.deps.log.info(`로컬 엔드포인트: http://127.0.0.1:${port}${MCP_ENDPOINT}`);
    } catch (error) {
      await this.stop();

      if (error instanceof PortInUseError) {
        const message = `포트 ${error.port}이(가) 사용 중입니다. gptBridge.port 설정을 바꾸세요.`;
        this.deps.store.update({ status: 'error', message });
        const choice = await vscode.window.showErrorMessage(
          `GPT Bridge: ${message}`,
          '설정 열기'
        );
        if (choice === '설정 열기') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'gptBridge.port');
        }
        return;
      }

      const reason = error instanceof Error ? error.message : String(error);
      this.deps.store.update({ status: 'error', message: reason });
      this.deps.log.error(`서버 시작 실패: ${reason}`);
      void vscode.window.showErrorMessage(`GPT Bridge: 서버 시작 실패 — ${reason}`);
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    const http = this.http;
    this.http = undefined;
    if (http !== undefined) {
      await http.stop();
    }
    this.deps.store.update({ status: 'stopped', port: undefined, tunnelUrl: undefined });
  }

  /** 토큰 재발급 시 호출. 실행 중이면 즉시 새 토큰만 유효해진다. */
  async refreshToken(): Promise<void> {
    if (this.isRunning) {
      this.token = await this.deps.secrets.getAuthToken();
      this.deps.log.warn('인증 토큰이 갱신되었습니다. 기존 토큰은 즉시 무효입니다.');
    }
  }

  dispose(): void {
    void this.stop();
  }
}
