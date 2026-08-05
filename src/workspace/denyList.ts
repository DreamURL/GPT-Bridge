import { globToRegExp, matchesPathOrSuffix } from './glob';

/**
 * 기본 거부 목록 (project.md §5.3).
 *
 * 설정으로 **추가만** 가능하고 제거할 수 없다. 여기 있는 항목이 뚫리면
 * 자격증명이 그대로 외부로 나간다.
 */
export const DEFAULT_DENY_PATTERNS: readonly string[] = [
  '.git/**',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa*',
  'id_ed25519*',
  '.ssh/**',
  '.aws/**',
  '.npmrc',
  '.netrc',
  '.vscode/settings.json'
];

/**
 * 목록·검색에서만 제외하는 경로. 읽기는 허용한다 (project.md §5.3).
 * 의존성 코드를 읽어야 할 때가 있어 거부 목록에 넣지 않는다.
 */
export const LISTING_EXCLUDE_PATTERNS: readonly string[] = ['node_modules/**'];

export class DenyList {
  private readonly patterns: readonly string[];
  private readonly regexes: readonly RegExp[];

  constructor(extraPatterns: readonly string[] = []) {
    const extra = extraPatterns.filter((pattern) => pattern.trim().length > 0);
    this.patterns = [...DEFAULT_DENY_PATTERNS, ...extra];
    this.regexes = this.patterns.map(globToRegExp);
  }

  /** 워크스페이스 루트 기준 상대 경로가 거부 대상인지 판정한다. */
  isDenied(relPath: string): boolean {
    return this.regexes.some((regex) => matchesPathOrSuffix(relPath, regex));
  }

  /** 어떤 패턴에 걸렸는지 — 감사 로그·사용자 알림용. */
  matchedPattern(relPath: string): string | undefined {
    for (let i = 0; i < this.regexes.length; i += 1) {
      const regex = this.regexes[i];
      if (regex !== undefined && matchesPathOrSuffix(relPath, regex)) {
        return this.patterns[i];
      }
    }
    return undefined;
  }

  get all(): readonly string[] {
    return this.patterns;
  }
}

const listingRegexes = LISTING_EXCLUDE_PATTERNS.map(globToRegExp);

/** 목록·검색 결과에서 걸러낼 경로인지 판정한다. */
export function isListingExcluded(relPath: string): boolean {
  return listingRegexes.some((regex) => matchesPathOrSuffix(relPath, regex));
}
