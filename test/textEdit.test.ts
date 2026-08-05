import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countOccurrences,
  CRLF,
  findUniqueOccurrence,
  LF,
  normalizeToEol,
  summarizeChange
} from '../src/workspace/textEdit';

/**
 * §11 추가 항목: edit_file의 old_string이 0회 / 2회 매치 → 각각 적절한 에러.
 * 그리고 Windows CRLF 파일에서의 매칭 — 이게 깨지면 주력 툴이 통째로 못 쓴다.
 */

describe('EOL 정규화', () => {
  it('LF로 통일한다', () => {
    assert.equal(normalizeToEol('a\r\nb\nc\rd', LF), 'a\nb\nc\nd');
  });

  it('CRLF로 통일한다', () => {
    assert.equal(normalizeToEol('a\r\nb\nc', CRLF), 'a\r\nb\r\nc');
  });

  it('이미 통일된 문자열은 그대로 둔다', () => {
    assert.equal(normalizeToEol('a\nb', LF), 'a\nb');
    assert.equal(normalizeToEol('a\r\nb', CRLF), 'a\r\nb');
  });

  it('줄바꿈이 없으면 바뀌지 않는다', () => {
    assert.equal(normalizeToEol('abc', CRLF), 'abc');
  });
});

describe('등장 횟수', () => {
  it('겹치지 않게 센다', () => {
    assert.equal(countOccurrences('aaaa', 'aa'), 2);
    assert.equal(countOccurrences('abcabc', 'abc'), 2);
    assert.equal(countOccurrences('abc', 'abc'), 1);
    assert.equal(countOccurrences('abc', 'xyz'), 0);
  });

  it('빈 문자열은 0', () => {
    assert.equal(countOccurrences('abc', ''), 0);
  });

  it('상한에서 멈춘다', () => {
    assert.equal(countOccurrences('aaaaaaaa', 'a', 2), 2);
  });
});

describe('§4.2 edit_file 매칭 — LF 파일', () => {
  const text = 'line one\nconst x = 1;\nline three\n';

  it('고유하게 등장하면 위치를 찾는다', () => {
    const result = findUniqueOccurrence(text, 'const x = 1;', LF);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') {
      return;
    }
    assert.equal(text.slice(result.start, result.end), 'const x = 1;');
  });

  it('여러 줄에 걸친 매칭', () => {
    const result = findUniqueOccurrence(text, 'const x = 1;\nline three', LF);
    assert.equal(result.kind, 'found');
  });

  it('0회 매치', () => {
    assert.deepEqual(findUniqueOccurrence(text, 'const y = 2;', LF), { kind: 'none' });
  });

  it('2회 이상 매치', () => {
    const repeated = 'foo();\nbar();\nfoo();\n';
    const result = findUniqueOccurrence(repeated, 'foo();', LF);
    assert.equal(result.kind, 'ambiguous');
  });

  it('빈 old_string', () => {
    assert.deepEqual(findUniqueOccurrence(text, '', LF), { kind: 'empty' });
  });
});

describe('§4.2 edit_file 매칭 — CRLF 파일 (Windows)', () => {
  const crlfText = 'line one\r\nconst x = 1;\r\nline three\r\n';

  it('GPT가 \\n으로 보낸 여러 줄 문자열이 CRLF 파일에서 매칭된다', () => {
    // 정규화가 없으면 여기서 0회 매치가 나고 edit_file이 영영 실패한다.
    const result = findUniqueOccurrence(crlfText, 'const x = 1;\nline three', crlfText.includes('\r\n') ? CRLF : LF);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') {
      return;
    }
    assert.equal(result.eol, CRLF);
    // 오프셋은 원본 기준이라 그대로 잘라내면 CRLF가 살아 있어야 한다
    assert.equal(crlfText.slice(result.start, result.end), 'const x = 1;\r\nline three');
  });

  it('한 줄짜리는 EOL과 무관하게 매칭된다', () => {
    const result = findUniqueOccurrence(crlfText, 'const x = 1;', CRLF);
    assert.equal(result.kind, 'found');
  });

  it('치환 문자열도 파일의 EOL로 맞춰진다', () => {
    const result = findUniqueOccurrence(crlfText, 'const x = 1;\nline three', CRLF);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') {
      return;
    }
    const replacement = normalizeToEol('const x = 2;\nline three', result.eol);
    assert.equal(replacement, 'const x = 2;\r\nline three');

    const updated = crlfText.slice(0, result.start) + replacement + crlfText.slice(result.end);
    assert.ok(!updated.includes('\n\n'), 'CRLF가 깨져 빈 줄이 생겼다');
    assert.equal(updated, 'line one\r\nconst x = 2;\r\nline three\r\n');
  });

  it('줄바꿈이 섞인 파일도 처리한다', () => {
    // 문서의 EOL은 CRLF로 보고되지만 실제로는 LF인 구간이 있는 경우.
    const mixed = 'a\r\nb\nc\r\n';
    const result = findUniqueOccurrence(mixed, 'b\nc', CRLF);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') {
      return;
    }
    assert.equal(result.eol, LF);
    assert.equal(mixed.slice(result.start, result.end), 'b\nc');
  });

  it('CRLF 파일에서도 중복은 중복으로 잡힌다', () => {
    const repeated = 'foo();\r\nbar();\r\nfoo();\r\n';
    assert.equal(findUniqueOccurrence(repeated, 'foo();', CRLF).kind, 'ambiguous');
  });

  it('LF 파일에 CRLF로 보내도 매칭된다', () => {
    const lfText = 'a\nb\nc\n';
    const result = findUniqueOccurrence(lfText, 'a\r\nb', LF);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') {
      return;
    }
    assert.equal(result.eol, LF);
  });
});

describe('변경 규모 요약', () => {
  it('추가된 줄을 센다', () => {
    assert.deepEqual(summarizeChange('a\nb\n', 'a\nb\nc\n'), { added: 1, removed: 0 });
  });

  it('삭제된 줄을 센다', () => {
    assert.deepEqual(summarizeChange('a\nb\nc\n', 'a\nc\n'), { added: 0, removed: 1 });
  });

  it('바뀐 줄은 추가 1 삭제 1', () => {
    assert.deepEqual(summarizeChange('a\nb\n', 'a\nB\n'), { added: 1, removed: 1 });
  });

  it('변화가 없으면 0', () => {
    assert.deepEqual(summarizeChange('a\nb\n', 'a\nb\n'), { added: 0, removed: 0 });
  });

  it('EOL만 다른 경우도 변화 없음으로 본다', () => {
    assert.deepEqual(summarizeChange('a\nb\n', 'a\r\nb\r\n'), { added: 0, removed: 0 });
  });
});
