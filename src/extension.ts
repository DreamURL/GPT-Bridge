import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { onConfigChange, readConfig } from './config';
import { BridgeServer } from './mcp/McpServer';
import { SecretStore } from './secrets';
import { BridgeStateStore } from './state';
import { BridgeViewProvider } from './ui/BridgeViewProvider';
import { createLogger } from './ui/output';
import { StatusBar } from './ui/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  // Disposable은 예외 없이 context.subscriptions에 등록한다 (project.md §0).
  // 확장 호스트는 리로드가 잦아 정리 누락 시 포트·프로세스가 누수된다.
  const log = createLogger();
  context.subscriptions.push(log);

  const store = new BridgeStateStore();
  const statusBar = new StatusBar();
  const secrets = new SecretStore(context.secrets);
  const view = new BridgeViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    store,
    statusBar,
    store.onDidChange((state) => {
      log.debug(`상태 변경: ${state.status}`);
      statusBar.update(state);
      view.render(state);
    }),
    vscode.window.registerWebviewViewProvider(BridgeViewProvider.viewType, view, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const server = new BridgeServer({
    log,
    store,
    secrets,
    extensionPath: context.extensionUri.fsPath,
    onActivity: (entry) => {
      const mark = entry.blocked === true ? '차단' : entry.ok ? 'ok' : '실패';
      log.info(`[${mark}] ${entry.tool} ${entry.detail} (${entry.durationMs}ms)`);
    }
  });
  context.subscriptions.push(server);

  statusBar.update(store.current);
  registerCommands(context, { log, store, secrets, server });

  context.subscriptions.push(
    onConfigChange((config) => {
      log.info(`설정 변경 감지 — port=${config.port}, approval=${config.approvalMode}`);
    })
  );

  const config = readConfig();
  log.info(
    `GPT Bridge 활성화됨 — port=${config.port}, autoStart=${config.autoStart}, ` +
      `tunnel=${config.tunnelProvider}, approval=${config.approvalMode}`
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    log.warn('열린 워크스페이스 폴더가 없습니다. 파일 툴은 워크스페이스가 있어야 동작합니다.');
  } else {
    log.info(`워크스페이스: ${folder.name}`);
  }

  if (config.autoStart && folder !== undefined) {
    log.info('autoStart가 켜져 있어 서버를 시작합니다.');
    void server.start();
  }
}

export function deactivate(): void {
  // 서버는 context.subscriptions에 등록된 BridgeServer.dispose()가 닫는다.
  // Phase 3에서 cloudflared 프로세스 종료(SIGTERM → 5초 → SIGKILL)를 여기에 붙인다.
}
