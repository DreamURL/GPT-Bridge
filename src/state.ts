import * as vscode from 'vscode';

/**
 * 브릿지의 실행 상태.
 *
 * 이 값은 상태바와 패널에 그대로 노출되므로 실제와 어긋나면 안 된다.
 * 서버가 뜨지 않았는데 'running'을 표시하는 식의 낙관적 갱신 금지.
 */
export type BridgeStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'tunneled'
  | 'error';

export interface BridgeState {
  readonly status: BridgeStatus;
  /** 서버가 바인드한 포트. 실행 중이 아니면 undefined. */
  readonly port: number | undefined;
  /** 외부 접근용 터널 URL. 터널이 붙기 전에는 undefined. */
  readonly tunnelUrl: string | undefined;
  /** 오류 상태일 때 사용자에게 보여줄 사유. */
  readonly message: string | undefined;
}

const INITIAL: BridgeState = {
  status: 'stopped',
  port: undefined,
  tunnelUrl: undefined,
  message: undefined
};

/** 상태 보관 + 변경 통지. UI(상태바·패널)는 여기만 구독한다. */
export class BridgeStateStore implements vscode.Disposable {
  private state: BridgeState = INITIAL;
  private readonly emitter = new vscode.EventEmitter<BridgeState>();

  readonly onDidChange: vscode.Event<BridgeState> = this.emitter.event;

  get current(): BridgeState {
    return this.state;
  }

  /** 변경분만 덮어쓴다. 값이 실제로 바뀐 경우에만 이벤트를 발생시킨다. */
  update(patch: Partial<BridgeState>): void {
    const next: BridgeState = { ...this.state, ...patch };
    if (
      next.status === this.state.status &&
      next.port === this.state.port &&
      next.tunnelUrl === this.state.tunnelUrl &&
      next.message === this.state.message
    ) {
      return;
    }
    this.state = next;
    this.emitter.fire(next);
  }

  reset(): void {
    this.update(INITIAL);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
