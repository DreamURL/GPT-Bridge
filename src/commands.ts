import * as vscode from 'vscode';
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
        log.debug(`명령 실행: ${id}`);
        void Promise.resolve(handler()).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          log.error(`명령 실패: ${id} — ${reason}`);
          void vscode.window.showErrorMessage(`GPT Bridge: ${reason}`);
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
      void vscode.window.showInformationMessage('GPT Bridge: 실행 중인 서버가 없습니다.');
      return;
    }
    await server.stop();
    void vscode.window.showInformationMessage('GPT Bridge: 서버를 중지했습니다.');
  });

  register('gptBridge.copyUrl', async () => {
    const { tunnelUrl, port } = store.current;

    // 터널이 아직 안 붙었으면 로컬 주소를 준다 — MCP Inspector로 확인할 때 필요하다.
    const url = tunnelUrl ?? (port === undefined ? undefined : `http://127.0.0.1:${port}${MCP_ENDPOINT}`);
    if (url === undefined) {
      void vscode.window.showWarningMessage(
        'GPT Bridge: 서버가 실행 중이 아닙니다. 먼저 "서버 시작"을 실행하세요.'
      );
      return;
    }

    await vscode.env.clipboard.writeText(url);
    const kind = tunnelUrl === undefined ? '로컬 엔드포인트' : '커넥터 URL';
    void vscode.window.showInformationMessage(`GPT Bridge: ${kind}를 복사했습니다 — ${url}`);
  });

  // ── 토큰 ────────────────────────────────────────────────────────
  register('gptBridge.copyToken', async () => {
    const token = await secrets.ensureAuthToken();
    onTokenChanged(token);
    await vscode.env.clipboard.writeText(token);
    log.info(`인증 토큰을 클립보드에 복사했습니다 (${maskToken(token)})`);
    void vscode.window.showInformationMessage(
      'GPT Bridge: 인증 토큰을 복사했습니다. ChatGPT 커넥터의 인증 헤더에 붙여 넣으세요.'
    );
  });

  register('gptBridge.regenerateToken', async () => {
    const confirmed = await vscode.window.showWarningMessage(
      '인증 토큰을 재발급하면 기존 토큰으로 연결된 ChatGPT 커넥터는 즉시 접근할 수 없게 됩니다. 계속할까요?',
      { modal: true },
      '재발급'
    );
    if (confirmed !== '재발급') {
      log.info('토큰 재발급 취소됨');
      return;
    }

    const token = await secrets.regenerateAuthToken();
    onTokenChanged(token);
    await server.refreshToken(); // 실행 중이면 기존 토큰을 즉시 무효화한다
    await vscode.env.clipboard.writeText(token);
    log.warn(`인증 토큰이 재발급되었습니다 (${maskToken(token)})`);
    void vscode.window.showInformationMessage(
      'GPT Bridge: 토큰을 재발급하고 클립보드에 복사했습니다. ChatGPT 커넥터 설정을 갱신하세요.'
    );
  });

  register('gptBridge.setTunnelToken', async () => {
    const existing = await secrets.getTunnelToken();
    const input = await vscode.window.showInputBox({
      title: 'Cloudflare Named Tunnel 토큰',
      prompt: '비워 두고 확인하면 저장된 토큰을 삭제합니다.',
      placeHolder: existing === undefined ? '토큰 붙여넣기' : '저장된 토큰이 있습니다',
      password: true,
      ignoreFocusOut: true
    });

    if (input === undefined) {
      return; // 사용자가 Esc로 취소
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      await secrets.clearTunnelToken();
      log.info('터널 토큰을 삭제했습니다');
      void vscode.window.showInformationMessage('GPT Bridge: 터널 토큰을 삭제했습니다.');
      return;
    }

    await secrets.setTunnelToken(trimmed);
    log.info('터널 토큰을 저장했습니다');

    const message = server.isRunning
      ? 'GPT Bridge: 터널 토큰을 저장했습니다. 적용하려면 서버를 다시 시작하세요.'
      : 'GPT Bridge: 터널 토큰을 저장했습니다. 공개 호스트명은 gptBridge.tunnel.hostname 설정에 지정하세요.';
    const choice = await vscode.window.showInformationMessage(
      message,
      ...(server.isRunning ? ['다시 시작'] : [])
    );
    if (choice === '다시 시작') {
      await server.stop();
      await server.start();
    }
  });

  // ── 안내 ────────────────────────────────────────────────────────
  register('gptBridge.copyInstructions', async () => {
    await vscode.env.clipboard.writeText(CHATGPT_INSTRUCTIONS);
    void vscode.window.showInformationMessage(
      `GPT Bridge: ChatGPT 지침을 복사했습니다. 등록 경로 — ${CONNECTOR_SETUP_PATH}`
    );
  });

  register('gptBridge.showLog', () => {
    log.show(true);
  });
}
