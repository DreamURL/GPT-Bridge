import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { readConfig, type ApprovalMode } from '../config';
import { CONNECTOR_SETUP_PATH } from '../instructions';
import { MCP_ENDPOINT } from '../mcp/http';
import type { ActivityEntry } from '../mcp/tools/types';
import { maskToken } from '../secrets';
import type { BridgeState, BridgeStateStore } from '../state';

const MAX_ACTIVITY = 40;

interface ActivityRow extends ActivityEntry {
  readonly time: string;
}

/**
 * 사이드바 Webview (project.md §7.1).
 *
 * CSP를 엄격하게 적용하고 nonce를 쓴다. 이 패널은 인증 토큰을 다루므로
 * 외부 리소스를 하나도 불러오지 않는다(default-src 'none').
 */
export class BridgeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'gptBridge.panel';

  private view: vscode.WebviewView | undefined;
  private activity: ActivityRow[] = [];
  private tokenPreview: string | undefined;

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
      void this.handleMessage(message);
    });

    this.render(this.store.current);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isPanelMessage(message)) {
      return;
    }

    if (message.type === 'command') {
      await vscode.commands.executeCommand(message.command);
      return;
    }

    if (message.type === 'setApprovalMode') {
      await vscode.workspace
        .getConfiguration('gptBridge')
        .update('approval.mode', message.value, vscode.ConfigurationTarget.Global);
      return;
    }

    if (message.type === 'setAutoSave') {
      await vscode.workspace
        .getConfiguration('gptBridge')
        .update('autoSave', message.value, vscode.ConfigurationTarget.Global);
      return;
    }

    if (message.type === 'showDetail') {
      await vscode.commands.executeCommand('gptBridge.showLog');
    }
  }

  /** 토큰 마스킹 표시용. 원문은 절대 Webview로 보내지 않는다. */
  setTokenPreview(token: string | undefined): void {
    this.tokenPreview = token === undefined ? undefined : maskToken(token);
    this.render(this.store.current);
  }

  pushActivity(entry: ActivityEntry): void {
    const time = new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    this.activity = [{ ...entry, time }, ...this.activity].slice(0, MAX_ACTIVITY);
    this.render(this.store.current);
  }

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
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    const config = readConfig();
    const running = state.status !== 'stopped' && state.status !== 'error';

    const connectorUrl =
      state.tunnelUrl !== undefined
        ? `${state.tunnelUrl}${MCP_ENDPOINT}`
        : state.port !== undefined
          ? `http://127.0.0.1:${state.port}${MCP_ENDPOINT}`
          : undefined;

    const isLocalOnly = state.tunnelUrl === undefined && connectorUrl !== undefined;
    const quickTunnel = state.tunnelUrl?.includes('trycloudflare.com') === true;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 10px 12px 16px;
    margin: 0;
  }
  section { margin-bottom: 16px; }
  section + section { border-top: 1px solid var(--vscode-panel-border); padding-top: 14px; }
  h2 {
    font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--vscode-descriptionForeground);
    margin: 0 0 8px; font-weight: 600;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .row.between { justify-content: space-between; }
  .status { font-weight: 600; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: ${dotColor(state)}; flex: none; }
  .value {
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 2px;
    padding: 3px 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .muted { color: var(--vscode-descriptionForeground); }
  .warn {
    color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
    background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder);
    border-radius: 2px; padding: 6px 8px; margin-top: 8px; line-height: 1.5;
  }
  label.field { display: block; font-size: 11px; margin: 10px 0 3px; color: var(--vscode-descriptionForeground); }
  button {
    padding: 4px 10px; border: none; border-radius: 2px; cursor: pointer;
    font-family: inherit; font-size: inherit; white-space: nowrap;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.block { display: block; width: 100%; margin-bottom: 6px; }
  select, input[type=checkbox] { font-family: inherit; font-size: inherit; }
  select {
    width: 100%; padding: 3px 4px;
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
  }
  .check { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  ul.activity { list-style: none; margin: 0; padding: 0; }
  ul.activity li {
    display: flex; gap: 6px; align-items: baseline;
    padding: 3px 4px; border-radius: 2px; font-size: 11px; cursor: pointer;
  }
  ul.activity li:hover { background: var(--vscode-list-hoverBackground); }
  ul.activity li.blocked {
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
  }
  ul.activity .time { color: var(--vscode-descriptionForeground); flex: none; }
  ul.activity .tool { font-weight: 600; flex: none; }
  ul.activity .detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px; border-radius: 2px;
  }
</style>
</head>
<body>
  <section>
    <div class="row between">
      <span class="status"><span class="dot"></span>${escapeHtml(describe(state))}</span>
      <button class="${running ? '' : 'primary'}" data-command="${running ? 'gptBridge.stop' : 'gptBridge.start'}">
        ${running ? '중지' : '시작'}
      </button>
    </div>
    ${state.message === undefined ? '' : `<div class="warn">${escapeHtml(state.message)}</div>`}
  </section>

  <section>
    <h2>커넥터</h2>
    <label class="field">커넥터 URL</label>
    <div class="row">
      <span class="value">${connectorUrl === undefined ? '서버가 실행 중이 아닙니다' : escapeHtml(connectorUrl)}</span>
      <button data-command="gptBridge.copyUrl">복사</button>
    </div>

    <label class="field">인증 토큰</label>
    <div class="row">
      <span class="value">${this.tokenPreview === undefined ? '아직 발급되지 않음' : escapeHtml(this.tokenPreview)}</span>
      <button data-command="gptBridge.copyToken">복사</button>
    </div>

    <div style="margin-top:10px">
      <button class="block primary" data-command="gptBridge.copyInstructions">ChatGPT 지침 복사</button>
    </div>

    ${
      isLocalOnly
        ? `<div class="warn">터널이 연결되지 않아 로컬 주소만 사용할 수 있습니다. ChatGPT 웹에서는 접근할 수 없고, MCP Inspector 같은 로컬 도구로만 확인할 수 있습니다.</div>`
        : ''
    }
    ${
      quickTunnel
        ? `<div class="warn">Quick Tunnel은 재시작할 때마다 URL이 바뀌어 ChatGPT 커넥터를 매번 다시 등록해야 합니다. 실사용에는 Named Tunnel을 권장합니다 — <code>GPT Bridge: 터널 토큰 설정</code> 실행 후 <code>gptBridge.tunnel.hostname</code>에 공개 호스트명을 지정하세요.</div>`
        : ''
    }
    <p class="muted" style="margin:10px 0 0; line-height:1.5">
      ChatGPT 등록 경로: ${escapeHtml(CONNECTOR_SETUP_PATH)}
    </p>
  </section>

  <section>
    <h2>동작</h2>
    <label class="field" for="approval">승인 모드</label>
    <select id="approval">
      ${approvalOption('always', '항상 확인', config.approvalMode)}
      ${approvalOption('session', '세션 자동 승인', config.approvalMode)}
      ${approvalOption('pattern', '패턴 자동 승인', config.approvalMode)}
    </select>
    <div class="check">
      <input type="checkbox" id="autosave" ${config.autoSave ? 'checked' : ''}>
      <label for="autosave">수정 후 자동 저장</label>
    </div>
    <p class="muted" style="margin:6px 0 0; line-height:1.5">
      자동 저장을 끄면 Ctrl+S 전까지 디스크에 반영되지 않습니다(권장).
      단, 파일 생성·삭제는 승인 즉시 디스크에 반영됩니다.
    </p>
  </section>

  <section>
    <h2>활동</h2>
    ${
      this.activity.length === 0
        ? '<p class="muted">아직 호출된 툴이 없습니다.</p>'
        : `<ul class="activity">${this.activity.map(activityRow).join('')}</ul>`
    }
  </section>

  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();

    for (const button of document.querySelectorAll('button[data-command]')) {
      button.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'command', command: button.dataset.command });
      });
    }

    document.getElementById('approval').addEventListener('change', (event) => {
      vscodeApi.postMessage({ type: 'setApprovalMode', value: event.target.value });
    });

    document.getElementById('autosave').addEventListener('change', (event) => {
      vscodeApi.postMessage({ type: 'setAutoSave', value: event.target.checked });
    });

    for (const item of document.querySelectorAll('ul.activity li')) {
      item.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'showDetail' });
      });
    }
  </script>
</body>
</html>`;
  }
}

function approvalOption(value: ApprovalMode, label: string, current: ApprovalMode): string {
  return `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
}

function activityRow(entry: ActivityRow): string {
  const blocked = entry.blocked === true;
  const mark = blocked ? '차단' : entry.ok ? '✓' : '✗';
  return (
    `<li class="${blocked ? 'blocked' : ''}" title="상세는 로그에서 확인">` +
    `<span class="time">${escapeHtml(entry.time)}</span>` +
    `<span class="tool">${escapeHtml(entry.tool)}</span>` +
    `<span class="detail">${escapeHtml(entry.detail)}</span>` +
    `<span>${mark}</span>` +
    `</li>`
  );
}

function describe(state: BridgeState): string {
  switch (state.status) {
    case 'stopped':
      return '중지됨';
    case 'starting':
      return '시작 중…';
    case 'running':
      return `로컬 실행 중 (포트 ${state.port ?? '?'})`;
    case 'tunneled':
      return '실행 중 · 터널 연결됨';
    case 'error':
      return '오류';
  }
}

function dotColor(state: BridgeState): string {
  switch (state.status) {
    case 'tunneled':
      return 'var(--vscode-charts-green)';
    case 'running':
      return 'var(--vscode-charts-blue)';
    case 'starting':
      return 'var(--vscode-charts-yellow)';
    case 'error':
      return 'var(--vscode-charts-red)';
    case 'stopped':
      return 'var(--vscode-descriptionForeground)';
  }
}

type PanelMessage =
  | { type: 'command'; command: string }
  | { type: 'setApprovalMode'; value: ApprovalMode }
  | { type: 'setAutoSave'; value: boolean }
  | { type: 'showDetail' };

function isPanelMessage(value: unknown): value is PanelMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;

  switch (record.type) {
    case 'command':
      // gptBridge.* 명령만 허용한다. Webview가 임의의 VS Code 명령을 실행하게 두면 안 된다.
      return typeof record.command === 'string' && record.command.startsWith('gptBridge.');
    case 'setApprovalMode':
      return record.value === 'always' || record.value === 'session' || record.value === 'pattern';
    case 'setAutoSave':
      return typeof record.value === 'boolean';
    case 'showDetail':
      return true;
    default:
      return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
