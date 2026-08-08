import * as vscode from 'vscode';
import { t } from './i18n';
import { CHATGPT_INSTRUCTIONS, CONNECTOR_SETUP_PATH } from './instructions';
import type { BridgeServer } from './mcp/McpServer';
import { MCP_ENDPOINT } from './mcp/http';
import { maskToken, type SecretStore } from './secrets';
import type { BridgeStateStore } from './state';

export interface CommandDeps {
  readonly log: vscode.LogOutputChannel;
  readonly store: BridgeStateStore;
  readonly secrets: SecretStore;
  readonly server: BridgeServer;
  /** 토큰이 새로 만들어지거나 바뀌었을 때 패널 표시를 갱신한다. */
  readonly onTokenChanged: (token: string | undefined) => void;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { log, store, secrets, server, onTokenChanged } = deps;

  const register = (id: string, handler: () => void | Promise<void>): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => {
        log.debug(`Command invoked: ${id}`);
        void Promise.resolve(handler()).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          log.error(`Command failed: ${id} - ${reason}`);
          void vscode.window.showErrorMessage(t('cmd.error', reason));
        });
      })
    );
  };

  // ── 서버 생명주기 ───────────────────────────────────────────────
  register('gptBridge.start', async () => {
    await server.start();
  });

  register('gptBridge.stop', async () => {
    if (!server.isRunning) {
      void vscode.window.showInformationMessage(t('cmd.serverNotRunningInfo'));
      return;
    }
    await server.stop();
    void vscode.window.showInformationMessage(t('cmd.serverStopped'));
  });

  register('gptBridge.copyUrl', async () => {
    const { tunnelUrl, port } = store.current;

    // 터널이 아직 안 붙었으면 로컬 주소를 준다 — MCP Inspector로 확인할 때 필요하다.
    const url = tunnelUrl ?? (port === undefined ? undefined : `http://127.0.0.1:${port}${MCP_ENDPOINT}`);
    if (url === undefined) {
      void vscode.window.showWarningMessage(t('cmd.startFirst'));
      return;
    }

    await vscode.env.clipboard.writeText(url);
    void vscode.window.showInformationMessage(
      tunnelUrl === undefined ? t('cmd.copiedLocal', url) : t('cmd.copiedConnector', url)
    );
  });

  // ── 토큰 ────────────────────────────────────────────────────────
  register('gptBridge.copyToken', async () => {
    const token = await secrets.ensureAuthToken();
    onTokenChanged(token);
    await vscode.env.clipboard.writeText(token);
    log.info(`Auth token copied to clipboard (${maskToken(token)})`);
    void vscode.window.showInformationMessage(t('cmd.tokenCopied'));
  });

  register('gptBridge.regenerateToken', async () => {
    const confirmed = await vscode.window.showWarningMessage(
      t('cmd.regenConfirm'),
      { modal: true },
      t('cmd.regenButton')
    );
    if (confirmed !== t('cmd.regenButton')) {
      log.info('Token regeneration cancelled');
      return;
    }

    const token = await secrets.regenerateAuthToken();
    onTokenChanged(token);
    await server.refreshToken(); // 실행 중이면 기존 토큰을 즉시 무효화한다
    await vscode.env.clipboard.writeText(token);
    log.warn(`Auth token regenerated (${maskToken(token)})`);
    void vscode.window.showInformationMessage(t('cmd.tokenRegenerated'));
  });

  register('gptBridge.setTunnelToken', async () => {
    const existing = await secrets.getTunnelToken();
    const input = await vscode.window.showInputBox({
      title: t('cmd.tunnelTokenTitle'),
      prompt: t('cmd.tunnelTokenPrompt'),
      placeHolder: existing === undefined ? t('cmd.tunnelTokenPaste') : t('cmd.tunnelTokenStored'),
      password: true,
      ignoreFocusOut: true
    });

    if (input === undefined) {
      return; // 사용자가 Esc로 취소
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      await secrets.clearTunnelToken();
      log.info('Tunnel token deleted');
      void vscode.window.showInformationMessage(t('cmd.tunnelTokenDeleted'));
      return;
    }

    await secrets.setTunnelToken(trimmed);
    log.info('Tunnel token saved');

    const message = server.isRunning
      ? t('cmd.tunnelTokenSavedRunning')
      : t('cmd.tunnelTokenSaved');
    const choice = await vscode.window.showInformationMessage(
      message,
      ...(server.isRunning ? [t('cmd.restart')] : [])
    );
    if (choice === t('cmd.restart')) {
      await server.stop();
      await server.start();
    }
  });

  // ── 안내 ────────────────────────────────────────────────────────
  register('gptBridge.copyInstructions', async () => {
    await vscode.env.clipboard.writeText(CHATGPT_INSTRUCTIONS);
    void vscode.window.showInformationMessage(t('cmd.instructionsCopied', CONNECTOR_SETUP_PATH));
  });

  register('gptBridge.showLog', () => {
    log.show(true);
  });
}
