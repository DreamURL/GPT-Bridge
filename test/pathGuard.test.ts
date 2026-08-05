import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PathError, PathGuard } from '../src/workspace/PathGuard';

/**
 * project.md §11 필수 테스트.
 *
 * 여기 있는 케이스는 전부 차단되어야 한다. 하나라도 통과하면
 * 워크스페이스 밖의 파일이 공개 HTTPS 엔드포인트로 새어 나간다.
 */

let sandbox: string;
let root: string;
let guard: PathGuard;

before(async () => {
  // 루트가 /work일 때 /work-secret이 통과하는지 확인하려면
  // 접두사를 공유하는 형제 디렉터리가 필요하다.
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-bridge-test-'));
  root = path.join(sandbox, 'work');
  const sibling = path.join(sandbox, 'work-secret');

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(path.join(root, '.ssh'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  await fs.mkdir(sibling, { recursive: true });

  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const x = 1;\n');
  await fs.writeFile(path.join(root, '..foo'), 'literal dotdot name\n');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=1\n');
  await fs.writeFile(path.join(root, '.env.local'), 'SECRET=2\n');
  await fs.writeFile(path.join(root, '.git', 'config'), '[core]\n');
  await fs.writeFile(path.join(root, '.ssh', 'known_hosts'), 'host\n');
  await fs.writeFile(path.join(root, 'id_rsa'), 'PRIVATE\n');
  await fs.writeFile(path.join(root, 'server.pem'), 'CERT\n');
  await fs.writeFile(path.join(root, 'node_modules', 'left-pad', 'index.js'), '\n');
  await fs.writeFile(path.join(sibling, 'a.txt'), 'sibling secret\n');
  await fs.writeFile(path.join(sandbox, 'outside.txt'), 'outside\n');

  // 워크스페이스 밖을 가리키는 심볼릭 링크
  await fs.symlink(sandbox, path.join(root, 'escape-link'), 'dir');
  await fs.symlink(path.join(sandbox, 'outside.txt'), path.join(root, 'escape-file'), 'file');
  // 워크스페이스 안을 가리키는 정상 링크 (오탐 확인용)
  await fs.symlink(path.join(root, 'src'), path.join(root, 'src-link'), 'dir');

  guard = new PathGuard({ root });
});

after(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

async function expectBlocked(userPath: string): Promise<void> {
  await assert.rejects(
    () => guard.resolve(userPath),
    (error: unknown) => {
      assert.ok(error instanceof PathError, `PathError가 아님: ${String(error)}`);
      return true;
    },
    `차단되지 않음: ${JSON.stringify(userPath)}`
  );
}

describe('§11 경로 탈출', () => {
  it('상위 디렉터리 탈출', async () => {
    await expectBlocked('../../../etc/passwd');
    await expectBlocked('src/../../secret.txt');
    await expectBlocked('..');
    await expectBlocked('./../../etc/passwd');
  });

  it('Windows 스타일 역슬래시 경로', async () => {
    await expectBlocked('..\\..\\..\\Windows\\System32\\config\\SAM');
    await expectBlocked('src\\app.ts');
  });

  it('절대 경로', async () => {
    await expectBlocked('/etc/passwd');
    await expectBlocked('C:\\Windows\\System32\\drivers\\etc\\hosts');
    await expectBlocked('C:/Windows/System32/drivers/etc/hosts');
    await expectBlocked(path.join(root, 'src', 'app.ts'));
  });

  it('URL 인코딩', async () => {
    await expectBlocked('src/%2e%2e/%2e%2e/secret.txt');
    await expectBlocked('%2e%2e/%2e%2e/etc/passwd');
    await expectBlocked('src%2fapp.ts');
  });

  it('널 바이트', async () => {
    await expectBlocked('src/app.ts\0.png');
    await expectBlocked('\0');
  });

  it('워크스페이스 외부를 가리키는 심볼릭 링크', async () => {
    await expectBlocked('escape-link/outside.txt');
    await expectBlocked('escape-file');
    // 링크 하위의 아직 없는 파일도 조상 링크를 해석해 막아야 한다
    await expectBlocked('escape-link/not-yet-created.txt');
  });

  it('접두사가 겹치는 형제 디렉터리 (/work vs /work-secret)', async () => {
    await expectBlocked('../work-secret/a.txt');
    await expectBlocked(path.join(sandbox, 'work-secret', 'a.txt'));
  });
});

describe('§11 거부 목록', () => {
  it('자격증명·설정 파일', async () => {
    await expectBlocked('.env');
    await expectBlocked('.env.local');
    await expectBlocked('.git/config');
    await expectBlocked('id_rsa');
    await expectBlocked('.ssh/known_hosts');
    await expectBlocked('server.pem');
  });

  it('대소문자를 바꿔도 차단된다', async () => {
    await expectBlocked('.ENV');
    await expectBlocked('.Git/config');
  });

  it('중첩된 위치의 .git도 차단된다', async () => {
    await expectBlocked('src/.git/config');
    await expectBlocked('a/b/.env');
  });

  it('거부 사유에 어떤 규칙에 걸렸는지 포함된다', async () => {
    await assert.rejects(
      () => guard.resolve('.env'),
      (error: unknown) => error instanceof PathError && error.message.includes('.env')
    );
  });

  it('설정으로 규칙을 추가할 수 있다', async () => {
    const strict = new PathGuard({ root, extraDenyPatterns: ['src/**'] });
    await assert.rejects(() => strict.resolve('src/app.ts'), PathError);
  });

  it('기본 규칙은 설정으로 제거할 수 없다', async () => {
    const loose = new PathGuard({ root, extraDenyPatterns: [] });
    await assert.rejects(() => loose.resolve('.env'), PathError);
  });
});

describe('정상 경로는 통과한다', () => {
  it('워크스페이스 내부 파일', async () => {
    const resolved = await guard.resolve('src/app.ts');
    assert.equal(resolved.relative, 'src/app.ts');
    assert.equal(resolved.absolute, path.join(await guard.realRoot(), 'src', 'app.ts'));
  });

  it('루트 자신', async () => {
    const resolved = await guard.resolve('.');
    assert.equal(resolved.relative, '');
  });

  it('빈 문자열은 루트로 취급한다', async () => {
    const resolved = await guard.resolve('');
    assert.equal(resolved.relative, '');
  });

  it('아직 존재하지 않는 파일 (신규 생성 대상)', async () => {
    const resolved = await guard.resolve('src/new-file.ts');
    assert.equal(resolved.relative, 'src/new-file.ts');
  });

  it('node_modules는 읽기 허용 (목록에서만 제외)', async () => {
    const resolved = await guard.resolve('node_modules/left-pad/index.js');
    assert.equal(resolved.relative, 'node_modules/left-pad/index.js');
  });

  it('워크스페이스 안을 가리키는 링크는 실제 경로로 정규화된다', async () => {
    const resolved = await guard.resolve('src-link/app.ts');
    assert.equal(resolved.relative, 'src/app.ts');
  });

  it("'..'로 시작하는 정상 파일명은 오탐하지 않는다", async () => {
    const resolved = await guard.resolve('..foo');
    assert.equal(resolved.relative, '..foo');
  });
});
