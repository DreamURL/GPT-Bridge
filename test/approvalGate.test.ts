import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ApprovalGate,
  type ApprovalRequest,
  type PromptChoice
} from '../src/approval/ApprovalGate';
import type { ApprovalMode } from '../src/config';

/**
 * §5.4 승인 게이트 / §5.4.1 만료 처리.
 *
 * 모달은 프로그램적으로 닫을 수 없다. 타임아웃이 지나도 화면의 창은 남고
 * 사용자가 뒤늦게 '적용'을 누를 수 있다. 그 선택이 파일을 건드리면 안 된다.
 */

const silentLog = { info: (): void => undefined, warn: (): void => undefined };

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: `req-${Math.random().toString(16).slice(2)}`,
    tool: 'edit_file',
    relPath: 'src/app.ts',
    summary: '+1 -1',
    diskImmediate: false,
    alwaysConfirm: false,
    ...overrides
  };
}

interface Harness {
  readonly gate: ApprovalGate;
  readonly promptCalls: ApprovalRequest[];
  readonly diffCalls: ApprovalRequest[];
  readonly expiredChoices: Array<{ request: ApprovalRequest; choice: PromptChoice }>;
}

function makeGate(options: {
  prompt: (request: ApprovalRequest, callIndex: number) => Promise<PromptChoice | undefined>;
  mode?: ApprovalMode;
  patterns?: readonly string[];
  timeoutMs?: number;
}): Harness {
  const promptCalls: ApprovalRequest[] = [];
  const diffCalls: ApprovalRequest[] = [];
  const expiredChoices: Array<{ request: ApprovalRequest; choice: PromptChoice }> = [];

  const gate = new ApprovalGate({
    timeoutMs: () => options.timeoutMs ?? 5_000,
    mode: () => options.mode ?? 'always',
    autoApprovePatterns: () => options.patterns ?? [],
    prompt: async (request) => {
      const index = promptCalls.length;
      promptCalls.push(request);
      return options.prompt(request, index);
    },
    showDiff: async (request) => {
      diffCalls.push(request);
    },
    onExpiredChoice: (request, choice) => {
      expiredChoices.push({ request, choice });
    },
    log: silentLog
  });

  return { gate, promptCalls, diffCalls, expiredChoices };
}

const never = (): Promise<PromptChoice | undefined> => new Promise(() => undefined);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('§5.4 기본 승인 흐름', () => {
  it("'적용'이면 승인", async () => {
    const h = makeGate({ prompt: async () => 'apply' });
    assert.equal(await h.gate.request(makeRequest()), 'approved');
  });

  it("'거부'면 거부", async () => {
    const h = makeGate({ prompt: async () => 'deny' });
    assert.equal(await h.gate.request(makeRequest()), 'denied');
  });

  it('취소(undefined)는 거부로 취급한다', async () => {
    const h = makeGate({ prompt: async () => undefined });
    assert.equal(await h.gate.request(makeRequest()), 'denied');
  });

  it("'Diff 보기'는 비교 창을 띄우고 다시 묻는다", async () => {
    const h = makeGate({
      prompt: async (_request, index) => (index === 0 ? 'diff' : 'apply')
    });

    assert.equal(await h.gate.request(makeRequest()), 'approved');
    assert.equal(h.diffCalls.length, 1);
    assert.equal(h.promptCalls.length, 2, '다시 묻지 않았다');
  });

  it("'Diff 보기'를 여러 번 눌러도 계속 묻는다", async () => {
    const h = makeGate({
      prompt: async (_request, index) => (index < 3 ? 'diff' : 'deny')
    });

    assert.equal(await h.gate.request(makeRequest()), 'denied');
    assert.equal(h.diffCalls.length, 3);
  });
});

describe('§5.4 직렬 큐 — 모달이 겹치면 안 된다', () => {
  it('동시 요청을 하나씩 처리한다', async () => {
    let active = 0;
    let maxActive = 0;

    const h = makeGate({
      prompt: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
        return 'apply';
      }
    });

    const results = await Promise.all([
      h.gate.request(makeRequest({ relPath: 'a.ts' })),
      h.gate.request(makeRequest({ relPath: 'b.ts' })),
      h.gate.request(makeRequest({ relPath: 'c.ts' }))
    ]);

    assert.deepEqual(results, ['approved', 'approved', 'approved']);
    assert.equal(maxActive, 1, `모달이 ${maxActive}개 동시에 떴다`);
  });

  it('요청 순서가 유지된다', async () => {
    const order: string[] = [];
    const h = makeGate({
      prompt: async (request) => {
        await delay(10);
        order.push(request.relPath);
        return 'apply';
      }
    });

    await Promise.all([
      h.gate.request(makeRequest({ relPath: 'first.ts' })),
      h.gate.request(makeRequest({ relPath: 'second.ts' })),
      h.gate.request(makeRequest({ relPath: 'third.ts' }))
    ]);

    assert.deepEqual(order, ['first.ts', 'second.ts', 'third.ts']);
  });

  it('한 요청이 만료돼도 큐가 멈추지 않는다', async () => {
    let call = 0;
    const h = makeGate({
      timeoutMs: 60,
      prompt: async () => {
        call += 1;
        return call === 1 ? never() : 'apply';
      }
    });

    const first = h.gate.request(makeRequest({ relPath: 'stuck.ts' }));
    const second = h.gate.request(makeRequest({ relPath: 'next.ts' }));

    assert.equal(await first, 'expired');
    assert.equal(await second, 'approved');
  });
});

describe('§5.4.1 만료 — 모달은 닫히지 않는다', () => {
  it('무응답이면 만료로 처리한다', async () => {
    const h = makeGate({ timeoutMs: 50, prompt: never });
    assert.equal(await h.gate.request(makeRequest()), 'expired');
  });

  it("만료 후 '적용'을 눌러도 승인되지 않는다", async () => {
    let resolvePrompt: ((choice: PromptChoice) => void) | undefined;
    const h = makeGate({
      timeoutMs: 50,
      prompt: () =>
        new Promise<PromptChoice>((resolve) => {
          resolvePrompt = resolve;
        })
    });

    const request = makeRequest();
    const decision = await h.gate.request(request);
    assert.equal(decision, 'expired');

    // 사용자가 뒤늦게 '적용'을 누른다.
    assert.ok(resolvePrompt !== undefined);
    resolvePrompt('apply');
    await delay(20);

    // 조용히 삼키지 않고 알린다.
    assert.equal(h.expiredChoices.length, 1);
    assert.equal(h.expiredChoices[0]?.choice, 'apply');
    assert.equal(h.expiredChoices[0]?.request.id, request.id);
  });

  it('만료 후 거부를 누르면 알림이 필요 없다', async () => {
    let resolvePrompt: ((choice: PromptChoice) => void) | undefined;
    const h = makeGate({
      timeoutMs: 50,
      prompt: () =>
        new Promise<PromptChoice>((resolve) => {
          resolvePrompt = resolve;
        })
    });

    await h.gate.request(makeRequest());
    resolvePrompt?.('deny');
    await delay(20);

    assert.equal(h.expiredChoices.length, 0);
  });

  it('제때 응답하면 만료되지 않는다', async () => {
    const h = makeGate({
      timeoutMs: 200,
      prompt: async () => {
        await delay(10);
        return 'apply';
      }
    });
    assert.equal(await h.gate.request(makeRequest()), 'approved');
  });
});

describe('§5.4 승인 모드', () => {
  it('always는 매번 묻는다', async () => {
    const h = makeGate({ mode: 'always', prompt: async () => 'apply' });

    await h.gate.request(makeRequest());
    await h.gate.request(makeRequest());
    await h.gate.request(makeRequest());

    assert.equal(h.promptCalls.length, 3);
  });

  it('session은 첫 승인 뒤 자동 승인한다', async () => {
    const h = makeGate({ mode: 'session', prompt: async () => 'apply' });

    assert.equal(await h.gate.request(makeRequest()), 'approved');
    assert.equal(await h.gate.request(makeRequest()), 'approved');
    assert.equal(await h.gate.request(makeRequest()), 'approved');

    assert.equal(h.promptCalls.length, 1, '두 번째부터는 묻지 않아야 한다');
  });

  it('session에서 첫 요청을 거부하면 자동 승인이 켜지지 않는다', async () => {
    const h = makeGate({ mode: 'session', prompt: async () => 'deny' });

    assert.equal(await h.gate.request(makeRequest()), 'denied');
    assert.equal(await h.gate.request(makeRequest()), 'denied');
    assert.equal(h.promptCalls.length, 2);
  });

  it('resetSession으로 세션 승인이 해제된다', async () => {
    const h = makeGate({ mode: 'session', prompt: async () => 'apply' });

    await h.gate.request(makeRequest());
    h.gate.resetSession();
    await h.gate.request(makeRequest());

    assert.equal(h.promptCalls.length, 2);
  });

  it('pattern은 매칭되는 경로만 자동 승인한다', async () => {
    const h = makeGate({
      mode: 'pattern',
      patterns: ['src/**'],
      prompt: async () => 'apply'
    });

    await h.gate.request(makeRequest({ relPath: 'src/app.ts' }));
    assert.equal(h.promptCalls.length, 0, 'src/**는 자동 승인이어야 한다');

    await h.gate.request(makeRequest({ relPath: 'docs/readme.md' }));
    assert.equal(h.promptCalls.length, 1, '패턴 밖은 물어야 한다');
  });

  it('빈 패턴은 무시한다 (전부 자동 승인되면 안 된다)', async () => {
    const h = makeGate({
      mode: 'pattern',
      patterns: ['', '   '],
      prompt: async () => 'apply'
    });

    await h.gate.request(makeRequest({ relPath: 'src/app.ts' }));
    assert.equal(h.promptCalls.length, 1);
  });
});

describe('§5.4 delete_path는 항상 확인한다', () => {
  for (const mode of ['always', 'session', 'pattern'] as const) {
    it(`${mode} 모드에서도 묻는다`, async () => {
      const h = makeGate({
        mode,
        patterns: ['**'],
        prompt: async () => 'apply'
      });

      // session 모드의 자동 승인 상태를 먼저 켜 둔다.
      await h.gate.request(makeRequest({ relPath: 'src/other.ts' }));
      const before = h.promptCalls.length;

      const decision = await h.gate.request(
        makeRequest({ tool: 'delete_path', relPath: 'src/app.ts', alwaysConfirm: true })
      );

      assert.equal(decision, 'approved');
      assert.equal(h.promptCalls.length, before + 1, `${mode}에서 삭제가 자동 승인되었다`);
    });
  }

  it('삭제 거부가 존중된다', async () => {
    const h = makeGate({ mode: 'session', prompt: async () => 'deny' });
    const decision = await h.gate.request(
      makeRequest({ tool: 'delete_path', alwaysConfirm: true })
    );
    assert.equal(decision, 'denied');
  });
});
