import * as crypto from 'node:crypto';

/**
 * 세션 동안 어떤 파일을 어디까지 읽었는지 기억한다.
 *
 * 목적은 차단이 아니라 **조언**이다. 파일 전체를 읽어야 하는 상황은 실제로
 * 있다 — 처음 구조를 파악할 때가 그렇다. 문제는 그 다음이다. 모델은 수정할
 * 때마다 같은 파일을 처음부터 다시 읽는 경향이 있고, 그러면 같은 내용이
 * 대화에 몇 번씩 쌓인다.
 *
 * 그래서 "이미 읽었고 그 뒤로 바뀌지 않았다"를 감지해 응답에 덧붙인다.
 * 내용은 그대로 돌려준다. 모델이 판단할 근거만 주는 것이다.
 *
 * vscode에 의존하지 않는다. 확장 호스트 없이 테스트하기 위해서다.
 */

export type ReadKind =
  /** 이 세션에서 처음 읽는 파일. */
  | 'first'
  /** 전체를 읽은 적이 있고, 그 뒤로 내용이 바뀌지 않았다. */
  | 'repeat-unchanged'
  /** 읽은 적이 있지만 내용이 달라졌다. 다시 읽는 게 맞다. */
  | 'repeat-changed'
  /** 읽은 적은 있으나 이번엔 범위 지정 요청이다. 권장하는 형태다. */
  | 'ranged';

interface Entry {
  /** 파일 전체를 읽은 적이 있는가. */
  readonly readWhole: boolean;
  /** 마지막으로 본 전체 내용의 지문. */
  readonly fingerprint: string;
}

/** 내용 지문. 충돌 위험이 낮으면 되고 암호학적 강도는 필요 없다. */
export function fingerprintOf(text: string): string {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
}

export class ReadTracker {
  private readonly seen = new Map<string, Entry>();

  /**
   * 읽기 1건을 기록하고 어떤 종류인지 알려준다.
   *
   * @param relPath    루트 기준 상대 경로.
   * @param wholeFile  범위 지정 없이 전체를 요청했는가.
   * @param fingerprint 파일 **전체** 내용의 지문. 범위 읽기여도 전체 기준으로 넘긴다.
   */
  record(relPath: string, wholeFile: boolean, fingerprint: string): ReadKind {
    const previous = this.seen.get(relPath);

    if (previous === undefined) {
      this.seen.set(relPath, { readWhole: wholeFile, fingerprint });
      return 'first';
    }

    // 전체를 다시 읽은 게 아니면 굳이 참견하지 않는다. 범위 읽기는 권장 형태다.
    if (!wholeFile) {
      this.seen.set(relPath, { readWhole: previous.readWhole, fingerprint });
      return 'ranged';
    }

    const changed = previous.fingerprint !== fingerprint;
    this.seen.set(relPath, { readWhole: true, fingerprint });

    if (!previous.readWhole) {
      // 전에는 일부만 봤다. 전체를 보는 게 처음이니 참견할 이유가 없다.
      return 'first';
    }
    return changed ? 'repeat-changed' : 'repeat-unchanged';
  }

  /** 서버를 내렸다 올리면 세션이 새로 시작된다. */
  reset(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
