import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprintOf, ReadTracker } from '../src/workspace/readTracker';

/**
 * 읽기 이력 추적 검증.
 *
 * 이 모듈의 목적은 차단이 아니라 조언이다. 따라서 확인할 것은
 * "언제 참견하고 언제 가만히 있는가"다. 과하게 참견하면 정당한 재읽기까지
 * 방해하는 잡음이 된다.
 */

const A = fingerprintOf('const a = 1;\n');
const B = fingerprintOf('const a = 2;\n');

describe('fingerprintOf', () => {
  it('같은 내용은 같은 지문', () => {
    assert.equal(fingerprintOf('hello'), fingerprintOf('hello'));
  });

  it('한 글자만 달라도 다른 지문', () => {
    assert.notEqual(fingerprintOf('hello'), fingerprintOf('hellO'));
  });

  it('빈 문자열도 처리한다', () => {
    assert.equal(typeof fingerprintOf(''), 'string');
    assert.ok(fingerprintOf('').length > 0);
  });
});

describe('ReadTracker — 처음 읽기', () => {
  it('처음 보는 파일은 first', () => {
    const tracker = new ReadTracker();
    assert.equal(tracker.record('src/app.ts', true, A), 'first');
  });

  it('파일마다 따로 기억한다', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    assert.equal(tracker.record('src/other.ts', true, A), 'first');
    assert.equal(tracker.size, 2);
  });

  it('일부만 읽었던 파일을 처음 전체로 읽으면 first', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', false, A);
    // 전체를 본 적은 없으므로 참견할 이유가 없다.
    assert.equal(tracker.record('src/app.ts', true, A), 'first');
  });
});

describe('ReadTracker — 반복 읽기', () => {
  it('전체를 두 번 읽고 내용이 그대로면 repeat-unchanged', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    assert.equal(tracker.record('src/app.ts', true, A), 'repeat-unchanged');
  });

  it('내용이 바뀌었으면 repeat-changed — 다시 읽는 게 맞다', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    assert.equal(tracker.record('src/app.ts', true, B), 'repeat-changed');
  });

  it('세 번째 읽기도 계속 감지한다', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    tracker.record('src/app.ts', true, A);
    assert.equal(tracker.record('src/app.ts', true, A), 'repeat-unchanged');
  });

  it('바뀐 뒤 다시 읽으면 그 내용이 새 기준이 된다', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    assert.equal(tracker.record('src/app.ts', true, B), 'repeat-changed');
    // 이제 B가 기준이므로 B를 또 읽으면 중복이다.
    assert.equal(tracker.record('src/app.ts', true, B), 'repeat-unchanged');
  });
});

describe('ReadTracker — 범위 읽기에는 참견하지 않는다', () => {
  it('전체를 읽은 뒤 범위로 읽으면 ranged', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    // 이게 우리가 유도하려는 형태다. 잔소리하면 안 된다.
    assert.equal(tracker.record('src/app.ts', false, A), 'ranged');
  });

  it('범위 읽기를 반복해도 ranged', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    tracker.record('src/app.ts', false, A);
    assert.equal(tracker.record('src/app.ts', false, A), 'ranged');
  });

  it('범위 읽기 뒤에도 전체 재읽기는 여전히 잡힌다', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    tracker.record('src/app.ts', false, A);
    assert.equal(tracker.record('src/app.ts', true, A), 'repeat-unchanged');
  });
});

describe('ReadTracker — 세션 경계', () => {
  it('reset하면 이력이 사라진다', () => {
    const tracker = new ReadTracker();
    tracker.record('src/app.ts', true, A);
    tracker.reset();
    assert.equal(tracker.size, 0);
    assert.equal(tracker.record('src/app.ts', true, A), 'first');
  });
});
