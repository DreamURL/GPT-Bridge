/**
 * `edit_file`의 문자열 매칭 (project.md §4.2).
 *
 * vscode에 의존하지 않는다. 여기가 틀리면 주력 툴이 통째로 못 쓰게 되므로
 * 확장 호스트 없이 테스트할 수 있어야 한다.
 *
 * ── 왜 줄바꿈 정규화가 필요한가 ──────────────────────────────────────
 * `TextDocument.getText()`는 문서의 EOL을 그대로 돌려준다. CRLF 파일에서는
 * `\r\n`이 섞여 나오는데, GPT는 거의 항상 `\n`으로 old_string을 보낸다.
 * 그대로 비교하면 Windows의 CRLF 파일에서 **항상 0회 매치로 실패**한다.
 *
 * 해결 방향은 두 가지가 있다.
 *   (a) 문서를 LF로 정규화해 찾고, 찾은 위치를 원본 오프셋으로 되돌린다.
 *   (b) 찾을 문자열을 문서의 EOL에 맞춰 바꾼 뒤 그대로 찾는다.
 *
 * (b)를 쓴다. 오프셋 역매핑이 없어 경계 조건에서 틀릴 여지가 없고,
 * 치환 문자열도 같은 EOL로 맞추면 파일의 줄바꿈 스타일이 보존된다.
 * 줄바꿈이 섞인 파일을 위해 다른 EOL 후보로도 한 번 더 시도한다.
 */

export const LF = '\n';
export const CRLF = '\r\n';

/** 어떤 줄바꿈이 섞여 있든 지정한 EOL로 통일한다. */
export function normalizeToEol(text: string, eol: string): string {
  const lf = text.replace(/\r\n/g, LF).replace(/\r/g, LF);
  return eol === LF ? lf : lf.split(LF).join(eol);
}

/** 겹치지 않는 등장 횟수. 상한에 도달하면 세는 것을 멈춘다. */
export function countOccurrences(haystack: string, needle: string, limit = 2): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    if (count >= limit) {
      return count;
    }
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export type MatchResult =
  | { readonly kind: 'found'; readonly start: number; readonly end: number; readonly eol: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly count: number }
  | { readonly kind: 'empty' };

/**
 * 문서에서 old_string이 정확히 한 번 등장하는 위치를 찾는다.
 *
 * documentEol을 먼저 시도하고, 줄바꿈이 섞인 파일을 위해 나머지 후보도 시도한다.
 * 반환하는 오프셋은 **원본 문자열 기준**이라 그대로 Range로 바꿀 수 있다.
 */
export function findUniqueOccurrence(
  haystack: string,
  needle: string,
  documentEol: string
): MatchResult {
  if (needle.length === 0) {
    return { kind: 'empty' };
  }

  const candidates = documentEol === CRLF ? [CRLF, LF] : [LF, CRLF];
  let ambiguousCount = 0;

  for (const eol of candidates) {
    const normalized = normalizeToEol(needle, eol);
    const count = countOccurrences(haystack, normalized);

    if (count === 1) {
      const start = haystack.indexOf(normalized);
      return { kind: 'found', start, end: start + normalized.length, eol };
    }
    if (count > 1) {
      ambiguousCount = Math.max(ambiguousCount, count);
    }
  }

  return ambiguousCount > 0 ? { kind: 'ambiguous', count: ambiguousCount } : { kind: 'none' };
}

export interface DiffSummary {
  readonly added: number;
  readonly removed: number;
}

/** 승인 프롬프트에 보여 줄 줄 단위 증감. 정확한 diff가 아니라 규모 표시용이다. */
export function summarizeChange(before: string, after: string): DiffSummary {
  const beforeLines = normalizeToEol(before, LF).split(LF);
  const afterLines = normalizeToEol(after, LF).split(LF);

  const beforeCounts = new Map<string, number>();
  for (const line of beforeLines) {
    beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  }

  let added = 0;
  for (const line of afterLines) {
    const remaining = beforeCounts.get(line) ?? 0;
    if (remaining > 0) {
      beforeCounts.set(line, remaining - 1);
    } else {
      added += 1;
    }
  }

  let removed = 0;
  for (const remaining of beforeCounts.values()) {
    removed += remaining;
  }

  return { added, removed };
}
