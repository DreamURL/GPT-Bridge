import * as vscode from 'vscode';
import type { BridgeState } from '../state';

/** 사이드바 컨테이너(package.json viewsContainers.id)를 포커스하는 내장 명령. */
const FOCUS_CONTAINER_COMMAND = 'workbench.view.extension.gptBridge';

interface Appearance {
  readonly icon: string;
  readonly label: string;
  readonly background: vscode.ThemeColor | undefined;
}

function appearanceOf(state: BridgeState): Appearance {
  switch (state.status) {
    case 'stopped':
      return { icon: 'circle-slash', label: '중지됨', background: undefined };
    case 'starting':
      return { icon: 'loading~spin', label: '시작 중', background: undefined };
    case 'running':
      return { icon: 'radio-tower', label: '로컬 실행 중', background: undefined };
    case 'tunneled':
      return { icon: 'radio-tower', label: '연결됨', background: undefined };
    case 'error':
      return {
        icon: 'error',
        label: '오류',
        background: new vscode.ThemeColor('statusBarItem.errorBackground')
      };
  }
}

function tooltipOf(state: BridgeState, label: string): vscode.MarkdownString {
  const lines = [`**GPT Bridge** — ${label}`];

  if (state.port !== undefined) {
    lines.push(`포트: \`127.0.0.1:${state.port}\``);
  }
  if (state.tunnelUrl !== undefined) {
    lines.push(`터널: ${state.tunnelUrl}`);
  }
  if (state.message !== undefined) {
    lines.push(`\n${state.message}`);
  }
  lines.push('\n클릭하면 패널이 열립니다.');

  return new vscode.MarkdownString(lines.join('\n\n'));
}

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('gptBridge.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'GPT Bridge';
    this.item.command = FOCUS_CONTAINER_COMMAND;
    this.item.show();
  }

  update(state: BridgeState): void {
    const appearance = appearanceOf(state);
    this.item.text = `$(${appearance.icon}) GPT Bridge`;
    this.item.tooltip = tooltipOf(state, appearance.label);
    this.item.backgroundColor = appearance.background;
  }

  dispose(): void {
    this.item.dispose();
  }
}
