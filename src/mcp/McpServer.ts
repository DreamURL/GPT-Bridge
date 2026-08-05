import * as vscode from 'vscode';
import type { ApprovalGate } from '../approval/ApprovalGate';
import type { AuditLog } from '../audit/AuditLog';
import type { PendingPreview } from '../approval/vscodeGate';
import { readConfig, type BridgeConfig } from '../config';
import type { SecretStore } from '../secrets';
import type { BridgeStateStore } from '../state';
import { ensureCloudflared } from '../tunnel/binary';
import { TunnelManager } from '../tunnel/TunnelManager';
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
  /** cloudflared 바이너리를 두는 곳 (context.globalStorageUri). */
  readonly storageDir: string;
  readonly onActivity: (entry: ActivityEntry) => void;
  readonly approvalGate: ApprovalGate;
  readonly audit: AuditLog;
  /** 'Diff 보기'용 내용 보관소. 요청 id로 키를 잡는다. */
  readonly previews: Map<string, PendingPreview>;
}

/**
 * MCP 서버 생명주기. 확장 쪽 관심사(워크스페이스, 설정, 상태, 알림)를
 * vscode 비의존 계층(McpHttpServer)에 연결한다.
 */
export class BridgeServer implements vscode.Disposable {
  private http: McpHttpServer | undefined;
  private tunnel: TunnelManager | undefined;
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
          this.deps.audit.append({
            kind: 'path_denied',
            tool,
            detail: requestedPath,
            ok: false,
            message: reason
          });
          void vscode.window.showWarningMessage(
            `GPT Bridge: 차단된 접근 시도 — ${tool} "${requestedPath}" (${reason})`
          );
        },
        onActivity: (entry) => {
          this.deps.audit.append({
            kind: 'tool_call',
            tool: entry.tool,
            detail: entry.detail,
            ok: entry.ok,
            durationMs: entry.durationMs
          });
          this.deps.onActivity(entry);
        },
        approve: async (request, preview) => {
          this.deps.previews.set(request.id, preview);
          try {
            const decision = await this.deps.approvalGate.request(request);

            if (decision === 'denied') {
              this.deps.audit.append({
                kind: 'approval_denied',
                tool: request.tool,
                detail: request.relPath,
                ok: false
              });
            } else if (decision === 'expired') {
              this.deps.audit.append({
                kind: 'approval_expired',
                tool: request.tool,
                detail: request.relPath,
                ok: false
              });
            } else if (request.diskImmediate) {
              // 디스크에 즉시 반영되는 작업은 별도로 남긴다 (§4.2.1).
              this.deps.audit.append({
                kind: 'disk_write',
                tool: request.tool,
                detail: request.relPath,
                ok: true
              });
            }

            return decision;
          } finally {
            // 만료된 요청의 모달이 아직 떠 있을 수 있으므로 바로 지우지 않는다.
            // 그때 'Diff 보기'를 눌러도 게이트가 선택을 버리지만, 미리보기가
            // 비어 있으면 사용자에게 혼란스러운 빈 창이 뜬다.
            setTimeout(() => this.deps.previews.delete(request.id), 5 * 60_000);
          }
        }
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
          this.deps.audit.append({
            kind: 'auth_failure',
            detail: remoteAddress ?? '주소 불명',
            ok: false,
            message: reason
          });
        }
      });

      const port = await http.start();
      this.http = http;
      this.deps.store.update({ status: 'running', port, message: undefined });
      this.deps.audit.append({ kind: 'server', detail: `started port=${port}`, ok: true });
      this.deps.log.info(`로컬 엔드포인트: http://127.0.0.1:${port}${MCP_ENDPOINT}`);

      if (config.tunnelProvider === 'cloudflare') {
        // 터널 실패는 서버 실패가 아니다. 로컬 엔드포인트는 계속 살아 있다.
        void this.startTunnel(port);
      } else {
        this.deps.log.info('터널 제공자가 none이라 로컬에서만 접근할 수 있습니다.');
      }
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

  /**
   * 터널 기동. 바이너리 확보(해시 검증 포함) → cloudflared 실행 → URL 파싱.
   * 어느 단계에서 실패해도 로컬 서버는 그대로 둔다.
   */
  private async startTunnel(port: number): Promise<void> {
    try {
      const binPath = await ensureCloudflared({
        storageDir: this.deps.storageDir,
        log: {
          info: (message) => this.deps.log.info(message),
          warn: (message) => this.deps.log.warn(message)
        }
      });

      const config = readConfig();
      const token = await this.deps.secrets.getTunnelToken();

      const tunnel = new TunnelManager({
        binPath,
        localPort: port,
        token,
        hostname: config.tunnelHostname,
        log: {
          info: (message) => this.deps.log.info(message),
          warn: (message) => this.deps.log.warn(message),
          error: (message) => this.deps.log.error(message)
        },
        onStatus: (status, url, message) => {
          if (status === 'connected') {
            this.deps.store.update({ status: 'tunneled', tunnelUrl: url, message });
            if (url !== undefined) {
              this.deps.log.info(`터널 연결됨: ${url}${MCP_ENDPOINT}`);
            }
            return;
          }
          if (status === 'failed') {
            // 서버 자체는 살아 있으므로 running으로 되돌린다.
            this.deps.store.update({ status: 'running', tunnelUrl: undefined, message });
            void vscode.window.showWarningMessage(
              `GPT Bridge: 터널 연결에 실패했습니다 — ${message ?? '사유 불명'}. 로컬 엔드포인트는 계속 사용할 수 있습니다.`
            );
            return;
          }
          if (status === 'stopped' && this.http !== undefined) {
            this.deps.store.update({ status: 'running', tunnelUrl: undefined });
          }
        }
      });

      this.tunnel = tunnel;
      const url = await tunnel.start();

      if (url !== undefined && token === undefined) {
        // Quick Tunnel은 재시작마다 URL이 바뀐다. 사용자가 알아야 한다.
        this.deps.log.warn(
          'Quick Tunnel은 재시작할 때마다 URL이 바뀝니다. 실사용에는 Named Tunnel을 권장합니다.'
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.log.error(`터널 시작 실패: ${reason}`);
      this.deps.store.update({ message: `터널 실패: ${reason}` });
      void vscode.window.showWarningMessage(
        `GPT Bridge: 터널을 시작하지 못했습니다 — ${reason}. 로컬 엔드포인트는 계속 사용할 수 있습니다.`
      );
    }
  }

  async stop(): Promise<void> {
    // 세션 자동 승인은 서버를 내리면 해제한다. 기획안은 확장 리로드 시
    // 해제를 요구하지만, 서버를 껐다 켠 것도 새 세션으로 보는 편이 안전하다.
    this.deps.approvalGate.resetSession();

    const tunnel = this.tunnel;
    this.tunnel = undefined;
    if (tunnel !== undefined) {
      await tunnel.stop();
    }

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
