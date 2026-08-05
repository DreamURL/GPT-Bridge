import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * ripgrep 실행 래퍼. `list_directory`와 `search_text`가 공유한다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * project.md §2.1이 가정한 것과 실제 패키지 구조가 다르다. 실측 결과:
 *
 *  1. `@vscode/ripgrep` 1.18은 **ESM 전용**(`"type": "module"`)이다.
 *     확장 번들은 CJS이고 VS Code 1.90의 Electron은 Node 20이라
 *     `require()`로 ESM을 불러올 수 없다. 따라서 이 패키지를 import하지 않고
 *     rgPath 계산 로직만 여기서 재현한다.
 *
 *  2. 바이너리는 `@vscode/ripgrep/bin/rg`에 없다. 플랫폼별 optional 패키지
 *     (`@vscode/ripgrep-linux-x64/bin/rg` 등)로 분리되어 있다.
 *     .vscodeignore도 그쪽을 포함시켜야 한다.
 *
 *  3. npm은 설치 시점 플랫폼의 optional 패키지만 내려받는다. 즉 .vsix는
 *     패키징한 OS/아키텍처에서만 검색이 동작한다. 개인 사용에는 문제없지만
 *     다른 기기에 설치하려면 그 기기에서 다시 패키징해야 한다.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SEARCH_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 15_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;

/** 플랫폼별 ripgrep 바이너리 경로. 못 찾으면 undefined. */
export function resolveRgPath(extensionPath?: string): string | undefined {
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;

  try {
    return require.resolve(`${platformPkg}/bin/${binaryName}`);
  } catch {
    // require.resolve가 실패하는 배치(예: 번들 위치가 예상과 다를 때)를 위한 대비책.
    if (extensionPath !== undefined) {
      const guess = path.join(extensionPath, 'node_modules', platformPkg, 'bin', binaryName);
      if (fs.existsSync(guess)) {
        return guess;
      }
    }
    return undefined;
  }
}

export class RipgrepError extends Error {}

interface RunResult {
  readonly stdout: string;
  readonly truncated: boolean;
}

/**
 * rg를 실행하고 stdout을 모은다. 인자는 배열로만 전달한다(셸 문자열 조합 금지).
 *
 * cwd는 반드시 워크스페이스 루트로 고정한다. `--glob` 패턴은 **cwd 기준**으로
 * 매칭되기 때문에, 임의의 cwd에서 실행하면 `!.git/**` 제외도 `include` 지정도
 * 조용히 무효가 된다(오류 없이 그냥 안 걸린다).
 */
function run(
  binPath: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      truncated = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_STDOUT_BYTES) {
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    });

    // stderr는 버리되 흘려보내야 파이프가 막히지 않는다.
    child.stderr.resume();

    child.on('error', (error) => {
      finish(() => reject(new RipgrepError(`ripgrep 실행 실패: ${error.message}`)));
    });

    child.on('close', (code) => {
      // rg 종료 코드: 0 = 매치 있음, 1 = 매치 없음, 2 이상 = 오류.
      // SIGKILL로 끊은 경우 code는 null이며 이는 정상적인 조기 종료다.
      finish(() => {
        if (code !== null && code > 1) {
          reject(new RipgrepError(`ripgrep이 코드 ${code}로 종료했습니다`));
          return;
        }
        resolve({ stdout: Buffer.concat(chunks).toString('utf8'), truncated });
      });
    });
  });
}

/** rg --json의 텍스트 필드는 UTF-8이 아니면 base64로 온다. */
interface RgText {
  readonly text?: string;
  readonly bytes?: string;
}

function decodeText(value: RgText | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value.text === 'string') {
    return value.text;
  }
  if (typeof value.bytes === 'string') {
    return Buffer.from(value.bytes, 'base64').toString('utf8');
  }
  return '';
}

export interface SearchLine {
  readonly number: number;
  readonly text: string;
  readonly isMatch: boolean;
}

export interface SearchBlock {
  /** 워크스페이스 루트 기준 상대 경로. */
  readonly path: string;
  readonly lines: readonly SearchLine[];
}

export interface SearchOptions {
  readonly query: string;
  readonly isRegex: boolean;
  readonly include: string | undefined;
  readonly maxResults: number;
  /**
   * 매치 줄 앞뒤로 함께 반환할 줄 수. 0이면 매치 줄만.
   *
   * 위치만 확인할 때는 0이 훨씬 싸다. 매치 50건에 앞뒤 2줄이면 250줄이
   * 모델의 컨텍스트로 들어가는데, 그중 200줄은 대개 쓰이지 않는다.
   */
  readonly contextLines: number;
}

export interface SearchOutcome {
  readonly blocks: readonly SearchBlock[];
  readonly matchCount: number;
  readonly truncated: boolean;
}

export interface ListOptions {
  /** 루트 기준 상대 경로. 루트 자신이면 ''. */
  readonly relativeDir: string;
  readonly limit: number;
}

export interface ListOutcome {
  /** 루트 기준 상대 경로 목록. .gitignore가 반영된다. */
  readonly files: readonly string[];
  readonly truncated: boolean;
}

export class Ripgrep {
  constructor(private readonly binPath: string) {}

  /**
   * 파일 목록. rg는 기본적으로 .gitignore / .ignore / .rgignore를 존중한다.
   *
   * `workspace.findFiles`를 쓰지 않는 이유: findFiles는 .gitignore를 반영하지
   * 않는다(files.exclude / search.exclude만 적용). .gitignore 존중은 proposed
   * API인 findFiles2의 useIgnoreFiles 옵션에서만 제공된다.
   */
  async listFiles(root: string, options: ListOptions): Promise<ListOutcome> {
    const target = options.relativeDir === '' ? root : path.join(root, options.relativeDir);

    const args = [
      '--files',
      '--hidden', // 점 파일도 포함. .git은 아래에서 따로 제외한다.
      '--no-messages',
      '--glob',
      '!.git/**',
      '--',
      target
    ];

    const { stdout, truncated } = await run(this.binPath, args, root, LIST_TIMEOUT_MS);

    const files: string[] = [];
    let overflow = truncated;

    for (const line of stdout.split('\n')) {
      if (line.length === 0) {
        continue;
      }
      if (files.length >= options.limit) {
        overflow = true;
        break;
      }
      files.push(path.relative(root, line).split(path.sep).join('/'));
    }

    return { files, truncated: overflow };
  }

  /** 텍스트 검색. 매치 줄과 앞뒤 2줄 컨텍스트를 반환한다. */
  async search(root: string, options: SearchOptions): Promise<SearchOutcome> {
    // 음수나 소수가 넘어오면 rg가 인자 오류로 죽는다. 여기서 정수로 고정한다.
    const context = Math.max(0, Math.floor(options.contextLines));

    const args = [
      '--json',
      '--context',
      String(context),
      '--hidden',
      '--no-messages',
      '--max-columns',
      '400',
      '--glob',
      '!.git/**'
    ];

    if (!options.isRegex) {
      args.push('--fixed-strings');
    }
    if (options.include !== undefined && options.include.length > 0) {
      args.push('--glob', options.include);
    }

    // '-e'로 패턴을 명시한다. 이게 없으면 '--foo' 같은 질의가 rg 옵션으로 해석된다.
    args.push('-e', options.query, '--', root);

    const { stdout, truncated } = await run(this.binPath, args, root, SEARCH_TIMEOUT_MS);
    return this.parseSearchOutput(stdout, root, options.maxResults, truncated);
  }

  private parseSearchOutput(
    stdout: string,
    root: string,
    maxResults: number,
    timedOut: boolean
  ): SearchOutcome {
    const blocks: SearchBlock[] = [];
    let current: { path: string; lines: SearchLine[] } | undefined;
    let matchCount = 0;
    let overflow = timedOut;

    const flush = (): void => {
      if (current !== undefined && current.lines.length > 0) {
        blocks.push({ path: current.path, lines: current.lines });
      }
      current = undefined;
    };

    for (const raw of stdout.split('\n')) {
      if (raw.length === 0) {
        continue;
      }

      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        continue; // 잘린 마지막 줄
      }
      if (typeof event !== 'object' || event === null) {
        continue;
      }

      const { type, data } = event as { type?: unknown; data?: unknown };
      if (typeof data !== 'object' || data === null) {
        continue;
      }

      if (type === 'begin') {
        flush();
        const filePath = decodeText((data as { path?: RgText }).path);
        current = { path: path.relative(root, filePath).split(path.sep).join('/'), lines: [] };
        continue;
      }

      if (type === 'end') {
        flush();
        continue;
      }

      if (type !== 'match' && type !== 'context') {
        continue;
      }
      if (current === undefined) {
        continue;
      }

      if (type === 'match') {
        if (matchCount >= maxResults) {
          overflow = true;
          continue;
        }
        matchCount += 1;
      }

      const entry = data as { line_number?: unknown; lines?: RgText };
      const lineNumber = typeof entry.line_number === 'number' ? entry.line_number : 0;
      current.lines.push({
        number: lineNumber,
        text: decodeText(entry.lines).replace(/\r?\n$/, ''),
        isMatch: type === 'match'
      });
    }

    flush();

    // 매치가 상한에 걸린 뒤에도 컨텍스트만 담긴 블록이 남을 수 있다.
    const meaningful = blocks.filter((block) => block.lines.some((line) => line.isMatch));
    return { blocks: meaningful, matchCount, truncated: overflow };
  }
}
