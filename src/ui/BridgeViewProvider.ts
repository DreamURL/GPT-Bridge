import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { CONNECTOR_SETUP_PATH } from '../instructions';
import type { BridgeState, BridgeStateStore } from '../state';

/**
 * 사이드바 Webview (project.md §7.1).
 *
 * Phase 1에서는 상태 표시와 명령 연결까지만 구현한다. URL·토큰 표시와 활동
 * 로그는 서버·터널이 붙는 Phase 3에서 채운다. 뷰를 package.json에 선언해 둔 채
 * provider를 등록하지 않으면 사이드바가 영구 로딩 상태로 남기 때문에,
 * 골격 단계에서도 provider는 등록한다.
 */
export class BridgeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'gptBridge.panel';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: BridgeStateStore
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (isCommandMessage(message)) {
        void vscode.commands.executeCommand(message.command);
      }
    });

    this.render(this.store.current);
  }

  /** 상태 변경 시 호출. 뷰가 아직 열리지 않았으면 조용히 넘어간다. */
  render(state: BridgeState): void {
    if (this.view === undefined) {
      return;
    }
    this.view.webview.html = this.html(this.view.webview, state);
  }

  private html(webview: vscode.Webview, state: BridgeState): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    const status = describe(state);

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 12px 12px 16px;
  }
  section { margin-bottom: 18px; }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--vscode-descriptionForeground);
    margin: 0 0 6px;
    font-weight: 600;
  }
  .status { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: ${dotColor(state)}; flex: none; }
  p { margin: 0 0 8px; line-height: 1.5; }
  .muted { color: var(--vscode-descriptionForeground); }
  button {
    display: block;
    width: 100%;
    margin-bottom: 6px;
    padding: 5px 10px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 2px;
  }
</style>
</head>
<body>
  <section>
    <div class="status"><span class="dot"></span>${escapeHtml(status)}</div>
  </section>

  <section>
    <h2>ChatGPT 연결</h2>
    <button data-command="gptBridge.copyInstructions">ChatGPT 지침 복사</button>
    <button data-command="gptBridge.copyToken">인증 토큰 복사</button>
    <button data-command="gptBridge.showLog">로그 열기</button>
    <p class="muted">등록 경로: ${escapeHtml(CONNECTOR_SETUP_PATH)}</p>
  </section>

  <section>
    <h2>Phase 1</h2>
    <p class="muted">
      확장 골격 단계입니다. MCP 서버와 터널은 아직 동작하지 않으며
      <code>서버 시작</code>은 Phase 2에서 연결됩니다.
    </p>
  </section>

  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    for (const button of document.querySelectorAll('button[data-command]')) {
      button.addEventListener('click', () => {
        vscodeApi.postMessage({ command: button.dataset.command });
      });
    }
  </script>
</body>
</html>`;
  }
}

function describe(state: BridgeState): string {
  switch (state.status) {
    case 'stopped':
      return '중지됨';
    case 'starting':
      return '시작 중…';
    case 'running':
      return `로컬 실행 중 (127.0.0.1:${state.port ?? '?'})`;
    case 'tunneled':
      return '연결됨';
    case 'error':
      return `오류: ${state.message ?? '알 수 없음'}`;
  }
}

function dotColor(state: BridgeState): string {
  switch (state.status) {
    case 'running':
    case 'tunneled':
      return 'var(--vscode-charts-green)';
    case 'starting':
      return 'var(--vscode-charts-yellow)';
    case 'error':
      return 'var(--vscode-charts-red)';
    case 'stopped':
      return 'var(--vscode-descriptionForeground)';
  }
}

interface CommandMessage {
  readonly command: string;
}

function isCommandMessage(value: unknown): value is CommandMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.startsWith('gptBridge.');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
