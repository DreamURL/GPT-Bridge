import type { ApprovalMode } from '../config';
import { globToRegExp, matchesPathOrSuffix } from '../workspace/glob';

/**
 * 쓰기 작업 승인 게이트 (project.md §5.4, §5.4.1).
 *
 * vscode에 의존하지 않는다. 프롬프트는 주입받는다 — 직렬 큐와 만료 처리가
 * 이 확장의 안전성을 지탱하는 로직이라 확장 호스트 없이 검증해야 한다.
 */

export type ApprovalDecision = 'approved' | 'denied' | 'expired';
export type PromptChoice = 'apply' | 'diff' | 'deny';

export interface ApprovalRequest {
  /** 요청마다 새로 발급하는 nonce. 만료된 응답을 식별하는 데 쓴다. */
  readonly id: string;
  readonly tool: string;
  readonly relPath: string;
  /** 사용자에게 보여 줄 변경 규모 요약. */
  readonly summary: string;
  /**
   * 승인 즉시 디스크에 반영되는 작업인지 (project.md §4.2.1).
   * 생성·삭제·이름변경이 여기 해당한다. 프롬프트 문구가 달라진다.
   */
  readonly diskImmediate: boolean;
  /** delete_path처럼 어떤 승인 모드에서도 항상 물어야 하는 작업. */
  readonly alwaysConfirm: boolean;
}

export interface ApprovalGateOptions {
  readonly timeoutMs: () => number;
  readonly mode: () => ApprovalMode;
  readonly autoApprovePatterns: () => readonly string[];
  /**
   * 사용자에게 묻는다. 취소(Esc)는 undefined.
   * 이 Promise는 만료 후에 resolve될 수 있다 — 아래 설명 참조.
   */
  readonly prompt: (request: ApprovalRequest) => Promise<PromptChoice | undefined>;
  readonly showDiff: (request: ApprovalRequest) => Promise<void>;
  /** 만료된 뒤 사용자가 '적용'을 눌렀을 때. 조용히 삼키지 않는다. */
  readonly onExpiredChoice: (request: ApprovalRequest, choice: PromptChoice) => void;
  readonly log: { info(message: string): void; warn(message: string): void };
}

interface RequestState {
  expired: boolean;
}

export class ApprovalGate {
  /** 직렬 큐. 모달이 겹치면 안 된다. */
  private tail: Promise<unknown> = Promise.resolve();
  private sessionApproved = false;

  constructor(private readonly options: ApprovalGateOptions) {}

  /** 확장 리로드 시 session 승인은 해제된다. 명시적으로 초기화할 때도 쓴다. */
  resetSession(): void {
    this.sessionApproved = false;
  }

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const run = this.tail.then(
      () => this.evaluate(request),
      () => this.evaluate(request)
    );
    // 큐가 실패로 끊기지 않게 결과를 흡수한다.
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async evaluate(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!request.alwaysConfirm) {
      const auto = this.autoDecision(request);
      if (auto !== undefined) {
        this.options.log.info(`Auto-approved (${auto}): ${request.tool} ${request.relPath}`);
        return 'approved';
      }
    }

    const state: RequestState = { expired: false };
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<ApprovalDecision>((resolve) => {
      timer = setTimeout(() => {
        state.expired = true;
        this.options.log.warn(
          `Approval window expired, treated as denied: ${request.tool} ${request.relPath} (id=${request.id})`
        );
        resolve('expired');
      }, this.options.timeoutMs());
    });

    let decision: ApprovalDecision;
    try {
      decision = await Promise.race([this.promptLoop(request, state), timeout]);
    } finally {
      // 사용자가 먼저 답했으면 타이머를 정리한다. 그대로 두면 나중에 발화해
      // state.expired를 켜 버리고, 확장 호스트에 쓸모없는 타이머가 남는다.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }

    if (decision === 'approved' && this.options.mode() === 'session') {
      this.sessionApproved = true;
    }
    return decision;
  }

  /** session·pattern 모드의 자동 승인 판정. 승인하지 않으면 undefined. */
  private autoDecision(request: ApprovalRequest): string | undefined {
    const mode = this.options.mode();

    if (mode === 'session' && this.sessionApproved) {
      return 'session';
    }

    if (mode === 'pattern') {
      for (const pattern of this.options.autoApprovePatterns()) {
        if (pattern.trim().length === 0) {
          continue;
        }
        if (matchesPathOrSuffix(request.relPath, globToRegExp(pattern))) {
          return `pattern: ${pattern}`;
        }
      }
    }

    return undefined;
  }

  /**
   * 'Diff 보기'를 고르면 비교 창을 띄우고 다시 묻는다.
   *
   * 이 루프는 만료 후에도 계속 돌 수 있다. 모달은 프로그램적으로 닫을 수
   * 없기 때문이다 — 화면의 창은 그대로 남는다. 만료된 뒤 나온 선택은
   * **버리고** 사용자에게 따로 알린다.
   */
  private async promptLoop(request: ApprovalRequest, state: RequestState): Promise<ApprovalDecision> {
    for (;;) {
      const choice = await this.options.prompt(request);

      if (state.expired) {
        if (choice === 'apply' || choice === 'diff') {
          this.options.onExpiredChoice(request, choice);
        }
        return 'expired';
      }

      if (choice === 'diff') {
        await this.options.showDiff(request);
        continue;
      }

      return choice === 'apply' ? 'approved' : 'denied';
    }
  }
}
