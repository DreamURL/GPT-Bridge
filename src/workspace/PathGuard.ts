import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DenyList } from './denyList';
import { toPosixPath } from './glob';

/**
 * 경로 검증 실패. 메시지는 그대로 GPT와 사용자에게 노출되므로
 * 시스템 경로를 담지 않는다.
 */
export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

export interface ResolvedPath {
  /** 심볼릭 링크까지 해석한 절대 경로. */
  readonly absolute: string;
  /** 실제 루트 기준 상대 경로(posix 구분자). 루트 자신이면 ''. */
  readonly relative: string;
}

export interface PathGuardOptions {
  readonly root: string;
  readonly extraDenyPatterns?: readonly string[];
}

const WINDOWS_DRIVE = /^[A-Za-z]:/;

/**
 * Windows 예약 장치명. 확장자가 붙어도(`CON.txt`) 여전히 장치를 가리킨다.
 * 열면 프로세스가 멈출 수 있다.
 */
const WINDOWS_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

/**
 * Windows 파일시스템이 경로를 정규화하는 방식 때문에 생기는 우회를 막는다.
 *
 * 이 검사는 **모든 플랫폼에서** 동작한다. 플랫폼별로 다르게 판정하면
 * 어느 쪽이 안전한지 추론하기 어려워지고, 여기서 걸리는 이름들은 정상적인
 * 프로젝트에 거의 등장하지 않는다.
 *
 *  - `:`      대체 데이터 스트림(ADS). `.env::$DATA`는 `.env` 본문을 그대로 읽는다.
 *             거부 목록은 `.env`와 문자열이 달라 걸러내지 못한다.
 *  - 후행 `.` / 공백
 *             Windows는 열 때 잘라낸다. `.npmrc.`는 `.npmrc`가 되지만
 *             거부 목록의 `.npmrc` 패턴에는 매칭되지 않는다.
 *  - 예약 장치명
 *             `CON`, `COM1` 등은 파일이 아니라 장치다.
 */
function assertNoWindowsTricks(userPath: string): void {
  if (userPath.includes(':')) {
    throw new PathError('경로에 콜론을 사용할 수 없습니다');
  }

  for (const segment of userPath.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      continue;
    }

    if (segment.endsWith('.') || segment.endsWith(' ')) {
      throw new PathError('경로 구성요소는 마침표나 공백으로 끝날 수 없습니다');
    }

    const stem = segment.split('.')[0]?.toLowerCase() ?? '';
    if (WINDOWS_DEVICE_NAMES.has(stem)) {
      throw new PathError(`예약된 장치명은 사용할 수 없습니다: ${segment}`);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code: unknown }).code === 'ENOENT' ||
      (error as { code: unknown }).code === 'ENOTDIR')
  );
}

/**
 * 존재하지 않는 경로도 처리하는 realpath.
 *
 * 가장 가까운 실존 조상까지 심볼릭 링크를 해석한 뒤 나머지 구간을 이어 붙인다.
 * `link/newfile.txt`에서 link가 워크스페이스 밖을 가리키는 경우를 잡아내려면
 * 파일이 아직 없더라도 조상 링크를 반드시 해석해야 한다.
 */
async function realpathOrParent(target: string): Promise<string> {
  let current = target;
  const trailing: string[] = [];

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return trailing.length === 0 ? real : path.join(real, ...trailing.reverse());
    } catch (error) {
      if (!isNotFound(error)) {
        throw new PathError('경로를 확인할 수 없습니다');
      }
      const parent = path.dirname(current);
      if (parent === current) {
        // 파일시스템 루트까지 올라갔다. 정상 경로에서는 도달할 수 없다.
        throw new PathError('경로를 확인할 수 없습니다');
      }
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * 모든 파일 접근이 통과하는 단일 관문 (project.md §5.3).
 *
 * vscode 모듈에 의존하지 않는다. 보안 판정의 핵심이라 확장 호스트 없이
 * 그대로 테스트할 수 있어야 하기 때문이다(§11).
 */
export class PathGuard {
  private readonly rootRaw: string;
  private readonly denyList: DenyList;
  private realRootCache: string | undefined;

  constructor(options: PathGuardOptions) {
    this.rootRaw = options.root;
    this.denyList = new DenyList(options.extraDenyPatterns ?? []);
  }

  get deny(): DenyList {
    return this.denyList;
  }

  /** 심볼릭 링크를 해석한 워크스페이스 루트. */
  async realRoot(): Promise<string> {
    if (this.realRootCache === undefined) {
      try {
        this.realRootCache = await fs.realpath(this.rootRaw);
      } catch {
        throw new PathError('워크스페이스 루트를 확인할 수 없습니다');
      }
    }
    return this.realRootCache;
  }

  /**
   * 사용자(=GPT)가 준 상대 경로를 검증해 실제 경로로 바꾼다.
   * 실패하면 반드시 PathError를 던진다. 조용히 통과시키는 경로는 없다.
   */
  async resolve(userPath: string): Promise<ResolvedPath> {
    const raw = this.validateSyntax(userPath);
    const realRoot = await this.realRoot();

    const resolved = path.resolve(realRoot, raw);

    // realpath 이전 형태로 1차 판정. 링크 해석 전에 이미 밖을 가리키면
    // 파일시스템을 건드리지 않고 끝낸다.
    this.assertInside(realRoot, resolved);

    const real = await realpathOrParent(resolved);
    const relative = this.assertInside(realRoot, real);

    const pattern = this.denyList.matchedPattern(relative);
    if (pattern !== undefined) {
      throw new PathError(`접근이 차단된 경로입니다 (거부 규칙: ${pattern})`);
    }

    return { absolute: real, relative };
  }

  /**
   * 파일시스템을 건드리지 않는 문법 검증.
   * 실제 경로 해석 전에 명백히 잘못된 입력을 먼저 쳐낸다.
   */
  private validateSyntax(userPath: string): string {
    if (typeof userPath !== 'string') {
      throw new PathError('경로는 문자열이어야 합니다');
    }

    if (userPath.includes('\0')) {
      throw new PathError('잘못된 경로입니다');
    }

    // URL 인코딩으로 검증을 우회하는 시도를 막는다.
    // path.resolve는 %2e를 해석하지 않으므로 'src/%2e%2e/x'는 루트 안쪽으로
    // 판정되어 통과해 버린다. 디코딩 결과가 달라지면 그대로 거부한다.
    let decoded: string;
    try {
      decoded = decodeURIComponent(userPath);
    } catch {
      throw new PathError('잘못된 경로입니다 (인코딩 오류)');
    }
    if (decoded !== userPath) {
      throw new PathError('URL 인코딩된 경로는 허용되지 않습니다. 디코딩된 경로를 사용하세요');
    }

    // 역슬래시는 경로 구분자로 받지 않는다. POSIX에서는 파일명의 일부라
    // '..\..\etc\passwd'가 루트 안쪽 파일명으로 통과해 버린다.
    if (userPath.includes('\\')) {
      throw new PathError('역슬래시는 허용되지 않습니다. 구분자로 /를 사용하세요');
    }

    if (WINDOWS_DRIVE.test(userPath)) {
      // path.isAbsolute('C:a.txt')는 win32에서도 false다. 드라이브 상대 경로는
      // 여기서 잡아야 한다.
      throw new PathError('상대 경로만 허용됩니다');
    }

    if (path.isAbsolute(userPath) || userPath.startsWith('/')) {
      throw new PathError('상대 경로만 허용됩니다');
    }

    const trimmed = userPath.trim();
    assertNoWindowsTricks(trimmed);

    return trimmed.length === 0 ? '.' : trimmed;
  }

  /**
   * 워크스페이스 안쪽인지 판정하고 상대 경로를 돌려준다.
   *
   * 접두사 비교(`real.startsWith(realRoot)`)로 구현하지 말 것.
   * 루트가 /work일 때 /work-secret이 통과한다. 반드시 path.relative로 판정한다.
   */
  private assertInside(realRoot: string, candidate: string): string {
    const rel = path.relative(realRoot, candidate);

    // '..'로 시작하는지만 보면 '..foo'라는 정상 파일명이 오탐된다.
    // 상위로 올라가는 경우는 rel이 '..' 자체이거나 '..' 뒤에 구분자가 온다.
    const escapes =
      rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../');

    if (escapes || path.isAbsolute(rel)) {
      throw new PathError('워크스페이스 외부 접근이 차단되었습니다');
    }
    return toPosixPath(rel);
  }
}
