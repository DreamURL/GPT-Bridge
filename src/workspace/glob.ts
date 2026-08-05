/**
 * 거부 목록·자동 승인 패턴에 쓰는 최소 glob 매처.
 *
 * minimatch를 끌어오지 않는 이유: 필요한 문법이 `*`, `**`, `?` 뿐이고,
 * 보안 판정에 쓰이는 코드라 동작을 전부 읽을 수 있는 편이 낫다.
 *
 * 지원 문법
 *   *   경로 구분자를 제외한 0자 이상
 *   ?   경로 구분자를 제외한 1자
 *   **  경로 구분자를 포함한 0자 이상
 *   x/** 는 x 자신과 그 하위 전부를 의미한다
 */

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

function escapeLiteral(text: string): string {
  return text.replace(REGEX_SPECIAL, '\\$&');
}

function compileBody(pattern: string): string {
  let out = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'; // '**/'는 디렉터리 0단계도 허용한다
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += escapeLiteral(ch ?? '');
      i += 1;
    }
  }

  return out;
}

/**
 * glob을 정규식으로 변환한다.
 *
 * 대소문자를 무시한다. macOS·Windows 파일시스템이 기본적으로
 * 대소문자를 구분하지 않으므로, `.ENV`가 `.env` 거부 규칙을 빠져나가면 안 된다.
 */
export function globToRegExp(pattern: string): RegExp {
  const endsWithTree = pattern.endsWith('/**');
  const core = endsWithTree ? pattern.slice(0, -3) : pattern;
  const body = compileBody(core) + (endsWithTree ? '(?:/.*)?' : '');
  return new RegExp(`^${body}$`, 'i');
}

/** OS별 구분자를 '/'로 통일한다. 패턴은 항상 '/'만 쓴다. */
export function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}

/**
 * 경로 자신과 모든 후행 부분경로에 대해 매칭을 시도한다.
 *
 * `a/b/.git/config`는 `.git/config`, `config`로도 검사된다. 덕분에
 * `.git/**` 같은 패턴이 서브모듈처럼 중첩된 위치에서도 걸린다.
 * 거부 목록은 넓게 걸리는 쪽이 안전하다.
 */
export function matchesPathOrSuffix(relPath: string, regex: RegExp): boolean {
  const normalized = toPosixPath(relPath);
  if (normalized.length === 0) {
    return false;
  }
  if (regex.test(normalized)) {
    return true;
  }

  const segments = normalized.split('/');
  for (let i = 1; i < segments.length; i += 1) {
    if (regex.test(segments.slice(i).join('/'))) {
      return true;
    }
  }
  return false;
}
