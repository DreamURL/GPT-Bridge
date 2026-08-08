import * as vscode from 'vscode';
import { t } from '../i18n';
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
      return { icon: 'circle-slash', label: t('status.stopped'), background: undefined };
    case 'starting':
      return { icon: 'loading~spin', label: t('status.starting'), background: undefined };
    case 'running':
      return { icon: 'radio-tower', label: t('status.running'), background: undefined };
    case 'tunneled':
      return { icon: 'radio-tower', label: t('status.tunneled'), background: undefined };
    case 'error':
      return {
        icon: 'error',
        label: t('status.error'),
        background: new vscode.ThemeColor('statusBarItem.errorBackground')
      };
  }
}

function tooltipOf(state: BridgeState, label: string): vscode.MarkdownString {
  const lines = [`**GPT Bridge** — ${label}`];

  if (state.port !== undefined) {
    lines.push(`${t('status.port')}: \`127.0.0.1:${state.port}\``);
  }
  if (state.tunnelUrl !== undefined) {
    lines.push(`${t('status.tunnel')}: ${state.tunnelUrl}`);
  }
  if (state.message !== undefined) {
    lines.push(`\n${state.message}`);
  }
  lines.push(`\n${t('status.clickToOpen')}`);

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
