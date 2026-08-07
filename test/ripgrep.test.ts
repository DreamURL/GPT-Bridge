import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Ripgrep, resolveRgPath } from '../src/workspace/ripgrep';

/**
 * ripgrep 래퍼 검증.
 *
 * 핵심은 .gitignore 반영이다. project.md rev.2에서 workspace.findFiles를
 * 버리고 rg로 간 이유가 이것이므로, 실제로 그렇게 동작하는지 확인해야 한다.
 */

let sandbox: string;
let rg: Ripgrep;

before(async () => {
  const rgPath = resolveRgPath();
  assert.ok(rgPath !== undefined, 'ripgrep 바이너리를 찾지 못했습니다');
  rg = new Ripgrep(rgPath);

  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-bridge-rg-'));
  await fs.mkdir(path.join(sandbox, 'src'), { recursive: true });
  await fs.mkdir(path.join(sandbox, 'build'), { recursive: true });
  await fs.mkdir(path.join(sandbox, '.git'), { recursive: true });

  await fs.writeFile(path.join(sandbox, '.gitignore'), 'build/\nsecret-notes.txt\n');
  await fs.writeFile(path.join(sandbox, 'src', 'app.ts'), 'export const needle = 1;\n');
  await fs.writeFile(
    path.join(sandbox, 'src', 'util.ts'),
    'line one\nline two\nconst needle = 2;\nline four\nline five\n'
  );
  await fs.writeFile(path.join(sandbox, 'build', 'bundle.js'), 'const needle = 3;\n');
  await fs.writeFile(path.join(sandbox, 'secret-notes.txt'), 'needle in ignored file\n');
  await fs.writeFile(path.join(sandbox, '.hidden-config'), 'needle in dotfile\n');
  await fs.writeFile(path.join(sandbox, '.git', 'config'), 'needle in git dir\n');
});

after(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('.gitignore에 등재된 파일은 목록에 나타나지 않는다', async () => {
    const { files } = await rg.listFiles(sandbox, { relativeDir: '', limit: 1000 });
    assert.ok(files.includes('src/app.ts'));
    assert.ok(!files.includes('build/bundle.js'), 'gitignore된 디렉터리가 노출됨');
    assert.ok(!files.includes('secret-notes.txt'), 'gitignore된 파일이 노출됨');
  });

  it('.git 디렉터리는 제외된다', async () => {
    const { files } = await rg.listFiles(sandbox, { relativeDir: '', limit: 1000 });
    assert.ok(!files.some((file) => file.startsWith('.git/')));
  });

  it('점 파일은 포함된다 (거부 목록은 상위에서 따로 적용)', async () => {
    const { files } = await rg.listFiles(sandbox, { relativeDir: '', limit: 1000 });
    assert.ok(files.includes('.hidden-config'));
  });

  it('하위 디렉터리만 조회할 수 있다', async () => {
    const { files } = await rg.listFiles(sandbox, { relativeDir: 'src', limit: 1000 });
    assert.deepEqual([...files].sort(), ['src/app.ts', 'src/util.ts']);
  });

  it('상한을 넘으면 truncated로 표시한다', async () => {
    const { files, truncated } = await rg.listFiles(sandbox, { relativeDir: '', limit: 1 });
    assert.equal(files.length, 1);
    assert.equal(truncated, true);
  });
});

describe('search', () => {
  it('매치 줄과 앞뒤 컨텍스트를 반환한다', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: 'src/**',
      maxResults: 50,
      contextLines: 2
    });

    const util = outcome.blocks.find((block) => block.path === 'src/util.ts');
    assert.ok(util !== undefined, 'src/util.ts 블록이 없음');

    const matched = util.lines.filter((line) => line.isMatch);
    assert.equal(matched.length, 1);
    assert.equal(matched[0]?.number, 3);
    assert.equal(matched[0]?.text, 'const needle = 2;');

    // 앞뒤 2줄 컨텍스트
    const numbers = util.lines.map((line) => line.number);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5]);
  });

  it('.gitignore된 파일은 검색되지 않는다', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: undefined,
      maxResults: 50,
      contextLines: 2
    });
    const paths = outcome.blocks.map((block) => block.path);
    assert.ok(!paths.includes('build/bundle.js'));
    assert.ok(!paths.includes('secret-notes.txt'));
    assert.ok(!paths.some((entry) => entry.startsWith('.git/')));
  });

  it('기본은 고정 문자열 매칭이라 정규식 메타문자가 그대로 취급된다', async () => {
    const literal = await rg.search(sandbox, {
      query: 'needle = 2;',
      isRegex: false,
      include: undefined,
      maxResults: 50,
      contextLines: 2
    });
    assert.equal(literal.matchCount, 1);

    // src/app.ts의 "needle = 1;"과 src/util.ts의 "needle = 2;" 둘 다 걸린다.
    const asRegex = await rg.search(sandbox, {
      query: 'needle = \\d;',
      isRegex: true,
      include: 'src/**',
      maxResults: 50,
      contextLines: 2
    });
    assert.equal(asRegex.matchCount, 2);

    // 정규식이 아닌데 메타문자를 넣으면 매치가 없어야 한다
    const noMatch = await rg.search(sandbox, {
      query: 'needle = \\d;',
      isRegex: false,
      include: undefined,
      maxResults: 50,
      contextLines: 2
    });
    assert.equal(noMatch.matchCount, 0);
  });

  it("'-'로 시작하는 질의가 rg 옵션으로 해석되지 않는다", async () => {
    // '-e'로 패턴을 명시하지 않으면 여기서 rg가 인자 오류로 죽는다.
    const outcome = await rg.search(sandbox, {
      query: '--version',
      isRegex: false,
      include: undefined,
      maxResults: 50,
      contextLines: 2
    });
    assert.equal(outcome.matchCount, 0);
  });

  it('max_results를 넘으면 truncated로 표시한다', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: undefined,
      maxResults: 1,
      contextLines: 2
    });
    assert.equal(outcome.matchCount, 1);
    assert.equal(outcome.truncated, true);
  });

  /**
   * 잘렸을 때 "얼마나 잘렸는지"를 알려 주지 못하면 모델은 범위를 좁힐 판단을
   * 할 수 없다. "1건"과 "3건 중 1건"은 같은 상황이 아니다.
   */
  it('상한에 걸려도 전체 매치 수는 끝까지 센다', async () => {
    const full = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: 'src/**',
      maxResults: 50,
      contextLines: 0
    });
    assert.equal(full.truncation, 'none');
    assert.equal(full.totalMatches, full.matchCount);
    assert.ok(full.totalMatches >= 2, 'src 아래 needle이 2건 이상이어야 함');

    const capped = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: 'src/**',
      maxResults: 1,
      contextLines: 0
    });

    assert.equal(capped.matchCount, 1, '응답에 담기는 건수는 상한을 지켜야 함');
    assert.equal(capped.totalMatches, full.totalMatches, '전체 건수는 상한과 무관해야 함');
    assert.ok(capped.totalMatches > capped.matchCount);
  });

  it('상한으로 잘린 것은 truncation이 limit이다', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: undefined,
      maxResults: 1,
      contextLines: 0
    });
    // 타임아웃·출력 초과와 구분되어야 한다. 해결책이 반대이기 때문이다.
    assert.equal(outcome.truncation, 'limit');
    assert.equal(outcome.truncated, true);
  });

  it('잘리지 않으면 truncation이 none이고 totalMatches가 matchCount와 같다', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: undefined,
      maxResults: 500,
      contextLines: 0
    });
    assert.equal(outcome.truncation, 'none');
    assert.equal(outcome.truncated, false);
    assert.equal(outcome.totalMatches, outcome.matchCount);
  });

  it('상한 500까지 한 번에 받을 수 있다', async () => {
    const many = path.join(sandbox, 'src', 'many.ts');
    await fs.writeFile(many, Array.from({ length: 300 }, (_, i) => `const needle${i} = ${i};`).join('\n'));
    try {
      const outcome = await rg.search(sandbox, {
        query: 'needle',
        isRegex: false,
        include: 'src/many.ts',
        maxResults: 500,
        contextLines: 0
      });
      assert.equal(outcome.matchCount, 300);
      assert.equal(outcome.totalMatches, 300);
      assert.equal(outcome.truncation, 'none');
    } finally {
      await fs.rm(many, { force: true });
    }
  });

  it('contextLines 0이면 매치 줄만 반환한다 (컨텍스트 절약)', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: 'src/**',
      maxResults: 50,
      contextLines: 0
    });

    const util = outcome.blocks.find((block) => block.path === 'src/util.ts');
    assert.ok(util !== undefined, 'src/util.ts 블록이 없음');

    // 앞뒤 줄 없이 3행 하나만 와야 한다.
    assert.deepEqual(util.lines.map((line) => line.number), [3]);
    assert.ok(util.lines.every((line) => line.isMatch));
  });

  it('contextLines를 늘리면 더 많은 줄이 온다', async () => {
    const narrow = await rg.search(sandbox, {
      query: 'needle = 2;',
      isRegex: false,
      include: 'src/**',
      maxResults: 50,
      contextLines: 1
    });
    const wide = await rg.search(sandbox, {
      query: 'needle = 2;',
      isRegex: false,
      include: 'src/**',
      maxResults: 50,
      contextLines: 2
    });

    const narrowLines = narrow.blocks[0]?.lines.length ?? 0;
    const wideLines = wide.blocks[0]?.lines.length ?? 0;
    assert.equal(narrowLines, 3, '앞뒤 1줄이면 3줄');
    assert.equal(wideLines, 5, '앞뒤 2줄이면 5줄');
  });

  it('음수 contextLines는 0으로 보정되어 rg가 죽지 않는다', async () => {
    // 정수 보정을 빼면 rg가 인자 오류(exit 2)로 종료한다.
    const outcome = await rg.search(sandbox, {
      query: 'needle',
      isRegex: false,
      include: 'src/**',
      maxResults: 50,
      contextLines: -3
    });
    assert.ok(outcome.matchCount > 0);
    assert.ok(outcome.blocks.every((block) => block.lines.every((line) => line.isMatch)));
  });

  it('매치가 없으면 빈 결과', async () => {
    const outcome = await rg.search(sandbox, {
      query: 'this-string-does-not-exist-anywhere',
      isRegex: false,
      include: undefined,
      maxResults: 50,
      contextLines: 2
    });
    assert.equal(outcome.blocks.length, 0);
    assert.equal(outcome.matchCount, 0);
  });
});
