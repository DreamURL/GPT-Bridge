import * as vscode from 'vscode';
import { DiffPreview } from './approval/DiffPreview';
import { AuditLog } from './audit/AuditLog';
import { createVscodeApprovalGate, type PendingPreview } from './approval/vscodeGate';
import { registerCommands } from './commands';
import { onConfigChange, readConfig } from './config';
import { setLanguage } from './i18n';
import { BridgeServer } from './mcp/McpServer';
import { SecretStore } from './secrets';
import { BridgeStateStore } from './state';
import { BridgeViewProvider } from './ui/BridgeViewProvider';
import { createLogger } from './ui/output';
import { StatusBar } from './ui/statusBar';

/**
 * deactivate에서 터널 프로세스를 확실히 정리하기 위해 참조를 남긴다.
 * context.subscriptions의 dispose()는 동기라 자식 프로세스 종료를 기다리지 못한다.
 */
let activeServer: BridgeServer | undefined;
let activeAudit: AuditLog | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Disposable은 예외 없이 context.subscriptions에 등록한다 (project.md §0).
  // 확장 호스트는 리로드가 잦아 정리 누락 시 포트·프로세스가 누수된다.
  const log = createLogger();
  context.subscriptions.push(log);

  // UI를 만들기 전에 언어를 확정한다. 뒤에 하면 상태바와 패널이 한 번
  // 영어로 그려졌다가 바뀌어 깜빡인다.
  setLanguage(readConfig().language);

  const store = new BridgeStateStore();
  const statusBar = new StatusBar();
  const secrets = new SecretStore(context.secrets);
  const view = new BridgeViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    store,
    statusBar,
    store.onDidChange((state) => {
      log.debug(`State changed: ${state.status}`);
      statusBar.update(state);
      view.render(state);
    }),
    vscode.window.registerWebviewViewProvider(BridgeViewProvider.viewType, view, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // 감사 로그 (§5.6). LogOutputChannel과 동시에 JSONL로도 남긴다.
  const audit = new AuditLog({
    directory: vscode.Uri.joinPath(context.globalStorageUri, 'audit').fsPath,
    onError: (message) => log.error(message)
  });
  log.info(`Audit log: ${audit.path}`);

  // 승인 게이트. session 모드 승인은 확장 리로드 시 자연히 해제된다 —
  // 이 객체가 새로 만들어지기 때문이다 (project.md §5.4).
  const diffPreview = new DiffPreview();
  const previews = new Map<string, PendingPreview>();
  const approvalGate = createVscodeApprovalGate(log, previews, diffPreview, (request, choice) =>
    audit.append({
      kind: 'expired_choice',
      tool: request.tool,
      detail: request.relPath,
      ok: false,
      message: `choice after expiry: ${choice}`
    })
  );
  context.subscriptions.push(diffPreview);

  const server = new BridgeServer({
    log,
    store,
    secrets,
    approvalGate,
    audit,
    previews,
    extensionPath: context.extensionUri.fsPath,
    storageDir: context.globalStorageUri.fsPath,
    onActivity: (entry) => {
      const mark = entry.blocked === true ? 'blocked' : entry.ok ? 'ok' : 'failed';
      log.info(`[${mark}] ${entry.tool} ${entry.detail} (${entry.durationMs}ms)`);
      view.pushActivity(entry);
    }
  });
  context.subscriptions.push(server);
  activeServer = server;
  activeAudit = audit;

  statusBar.update(store.current);
  registerCommands(context, {
    log,
    store,
    secrets,
    server,
    onTokenChanged: (token) => view.setTokenPreview(token)
  });

  // 이미 발급된 토큰이 있으면 패널에 마스킹해 보여 준다.
  void secrets.getAuthToken().then((token) => view.setTokenPreview(token));

  context.subscriptions.push(
    onConfigChange((config) => {
      log.info(`Configuration changed - port=${config.port}, approval=${config.approvalMode}`);
      // 언어를 먼저 반영해야 아래 다시 그리기와 상태바가 새 언어로 나온다.
      setLanguage(config.language);
      statusBar.update(store.current);
      // 패널의 승인 모드·자동 저장 표시가 설정과 어긋나지 않게 다시 그린다.
      view.render(store.current);
    })
  );

  const config = readConfig();
  log.info(
    `GPT Bridge activated - port=${config.port}, autoStart=${config.autoStart}, ` +
      `tunnel=${config.tunnelProvider}, approval=${config.approvalMode}, lang=${config.language}`
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    log.warn('No workspace folder is open. File tools need a workspace to operate on.');
  } else {
    log.info(`Workspace: ${folder.name}`);
  }

  if (config.autoStart && folder !== undefined) {
    log.info('autoStart is enabled - starting the server.');
    void server.start();
  }
}

/**
 * VS Code는 deactivate가 돌려준 Promise를 기다린다. 여기서 cloudflared를
 * SIGTERM → 5초 → SIGKILL로 정리한다. 이걸 빠뜨리면 확장 호스트가 리로드될 때
 * 좀비 프로세스가 남아 포트를 계속 물고 있게 된다 (project.md §6).
 */
export async function deactivate(): Promise<void> {
  const server = activeServer;
  const audit = activeAudit;
  activeServer = undefined;
  activeAudit = undefined;
  if (server !== undefined) {
    await server.stop();
  }
  // 큐에 남은 기록이 디스크에 닿을 때까지 기다린다.
  if (audit !== undefined) {
    audit.append({ kind: 'server', detail: 'deactivated', ok: true });
    await audit.flush();
  }
}
