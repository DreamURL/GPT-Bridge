import * as vscode from 'vscode';

/**
 * LogOutputChannel은 레벨·타임스탬프를 자체적으로 붙이고 사용자가 출력 패널에서
 * 레벨을 조절할 수 있다. Phase 5의 감사 로그(§5.6)도 여기에 동시 출력한다.
 */
export function createLogger(): vscode.LogOutputChannel {
  return vscode.window.createOutputChannel('GPT Bridge', { log: true });
}
