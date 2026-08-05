import * as vscode from 'vscode';
import { CHATGPT_INSTRUCTIONS, CONNECTOR_SETUP_PATH } from './instructions';
import { maskToken, type SecretStore } from './secrets';
import type { BridgeStateStore } from './state';

export interface CommandDeps {
  readonly log: vscode.LogOutputChannel;
  readonly store: BridgeStateStore;
  readonly secrets: SecretStore;
}

/** Phase 2/3에서 실제 구현이 붙기 전까지 쓰는 안내. */
const NOT_YET = (phase: string, what: string): void => {
  void vscode.window.showInformationMessage(`${what}은(는) ${phase}에서 구현됩니다.`);
};

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { log, store, secrets } = deps;

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
  // Phase 1은 스텁이다. 상태를 'running'으로 바꾸지 않는다. 서버가 뜨지 않았는데
  // 실행 중으로 표시하면 상태바가 거짓말을 하게 되고, 이 확장에서 상태 표시가
  // 어긋나는 것은 그 자체로 보안 문제다.
  register('gptBridge.start', () => {
    log.info('서버 시작 요청 — Phase 2 미구현 스텁');
    NOT_YET('Phase 2', 'MCP 서버 시작');
  });

  register('gptBridge.stop', () => {
    log.info('서버 중지 요청 — 실행 중인 서버가 없습니다');
    NOT_YET('Phase 2', 'MCP 서버 중지');
  });

  register('gptBridge.copyUrl', async () => {
    const { tunnelUrl } = store.current;
    if (tunnelUrl === undefined) {
      void vscode.window.showWarningMessage(
        'GPT Bridge: 아직 커넥터 URL이 없습니다. 터널은 Phase 3에서 구현됩니다.'
      );
      return;
    }
    await vscode.env.clipboard.writeText(tunnelUrl);
    void vscode.window.showInformationMessage('GPT Bridge: 커넥터 URL을 복사했습니다.');
  });

  // ── 토큰 ────────────────────────────────────────────────────────
  register('gptBridge.copyToken', async () => {
    const token = await secrets.ensureAuthToken();
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
    void vscode.window.showInformationMessage(
      'GPT Bridge: 터널 토큰을 저장했습니다. 적용은 Phase 3에서 터널이 붙을 때 이루어집니다.'
    );
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
