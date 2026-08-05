import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import {
  assetForPlatform,
  binaryFileName,
  CLOUDFLARED_VERSION,
  downloadUrl,
  hashMatches,
  isAllowedHost,
  sha256
} from '../src/tunnel/binary';
import { extractFileFromTgz, readTar, TarError } from '../src/tunnel/tar';
import { backoffDelayMs, MAX_RESTART_ATTEMPTS, normalizeUrl, parseQuickTunnelUrl } from '../src/tunnel/TunnelManager';

/** 512바이트 정렬을 지키는 최소 ustar 아카이브를 만든다. */
function makeTar(files: ReadonlyArray<{ name: string; body: string; type?: string }>): Buffer {
  const blocks: Buffer[] = [];

  for (const file of files) {
    const header = Buffer.alloc(512);
    header.write(file.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'utf8');
    header.write('0000000\0', 108, 8, 'utf8');
    header.write('0000000\0', 116, 8, 'utf8');
    const size = Buffer.byteLength(file.body, 'utf8');
    header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
    header.write('00000000000\0', 136, 12, 'utf8');
    header.write(file.type ?? '0', 156, 1, 'utf8');
    header.write('ustar\0', 257, 6, 'utf8');

    // 체크섬 필드는 계산 시 공백으로 채운 상태로 합산한다.
    header.write('        ', 148, 8, 'utf8');
    let sum = 0;
    for (const byte of header) {
      sum += byte;
    }
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');

    blocks.push(header);

    const data = Buffer.alloc(Math.ceil(size / 512) * 512);
    data.write(file.body, 0, 'utf8');
    blocks.push(data);
  }

  blocks.push(Buffer.alloc(1024)); // 종료 블록 2개
  return Buffer.concat(blocks);
}

describe('tar 리더', () => {
  it('일반 파일을 읽는다', () => {
    const archive = makeTar([
      { name: 'cloudflared', body: 'BINARY-CONTENT' },
      { name: 'README', body: 'hello' }
    ]);
    const entries = readTar(archive);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['cloudflared', 'README']
    );
    assert.equal(entries[0]?.data.toString('utf8'), 'BINARY-CONTENT');
  });

  it('디렉터리 엔트리는 건너뛴다', () => {
    const archive = makeTar([
      { name: 'dir/', body: '', type: '5' },
      { name: 'dir/cloudflared', body: 'X' }
    ]);
    const entries = readTar(archive);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['dir/cloudflared']
    );
  });

  it('gzip 아카이브에서 이름으로 꺼낸다', () => {
    const archive = zlib.gzipSync(makeTar([{ name: 'cloudflared', body: 'CF' }]));
    assert.equal(extractFileFromTgz(archive, 'cloudflared').toString('utf8'), 'CF');
  });

  it('경로가 붙어 있어도 basename으로 찾는다', () => {
    const archive = zlib.gzipSync(makeTar([{ name: './cloudflared', body: 'CF' }]));
    assert.equal(extractFileFromTgz(archive, 'cloudflared').toString('utf8'), 'CF');
  });

  it('없는 파일을 요구하면 실패한다 (조용히 넘어가지 않는다)', () => {
    const archive = zlib.gzipSync(makeTar([{ name: 'other', body: 'X' }]));
    assert.throws(() => extractFileFromTgz(archive, 'cloudflared'), TarError);
  });

  it('gzip이 아니면 실패한다', () => {
    assert.throws(() => extractFileFromTgz(Buffer.from('not gzip'), 'cloudflared'), TarError);
  });

  it('잘린 아카이브는 실패한다', () => {
    const archive = makeTar([{ name: 'cloudflared', body: 'X'.repeat(1000) }]);
    assert.throws(() => readTar(archive.subarray(0, 700)), TarError);
  });
});

describe('§6.1 다운로드 호스트 화이트리스트', () => {
  it('GitHub 릴리스 호스트만 허용한다', () => {
    assert.equal(isAllowedHost('https://github.com/cloudflare/cloudflared/releases/x'), true);
    assert.equal(isAllowedHost('https://release-assets.githubusercontent.com/abc'), true);
    assert.equal(isAllowedHost('https://objects.githubusercontent.com/abc'), true);
  });

  it('다른 호스트는 거부한다', () => {
    assert.equal(isAllowedHost('https://evil.example.com/cloudflared'), false);
    assert.equal(isAllowedHost('https://github.com.evil.example.com/x'), false);
    assert.equal(isAllowedHost('https://notgithub.com/x'), false);
  });

  it('http는 거부한다', () => {
    assert.equal(isAllowedHost('http://github.com/x'), false);
  });

  it('URL이 아니면 거부한다', () => {
    assert.equal(isAllowedHost('not a url'), false);
    assert.equal(isAllowedHost(''), false);
  });
});

describe('§6.1 버전 핀과 해시 테이블', () => {
  it('주요 플랫폼의 자산이 등록되어 있다', () => {
    for (const key of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64']) {
      const spec = assetForPlatform(key);
      assert.ok(spec !== undefined, `${key} 미등록`);
      assert.match(spec.assetSha256, /^[0-9a-f]{64}$/, `${key} assetSha256 형식 오류`);
      assert.match(spec.binarySha256, /^[0-9a-f]{64}$/, `${key} binarySha256 형식 오류`);
    }
  });

  it('raw 바이너리는 자산 해시와 실행 파일 해시가 같다', () => {
    for (const key of ['linux-x64', 'linux-arm64', 'win32-x64']) {
      const spec = assetForPlatform(key);
      assert.equal(spec?.assetSha256, spec?.binarySha256, key);
    }
  });

  it('아카이브 배포는 두 해시가 다르다 (존재 확인으로 퇴화하지 않는다)', () => {
    for (const key of ['darwin-x64', 'darwin-arm64']) {
      const spec = assetForPlatform(key);
      assert.notEqual(spec?.assetSha256, spec?.binarySha256, key);
      assert.equal(spec?.archiveMember, 'cloudflared');
    }
  });

  it('미지원 플랫폼은 undefined', () => {
    assert.equal(assetForPlatform('freebsd-x64'), undefined);
  });

  it('다운로드 URL이 핀 고정 버전을 가리킨다', () => {
    const url = downloadUrl('cloudflared-linux-amd64');
    assert.ok(url.includes(`/download/${CLOUDFLARED_VERSION}/`));
    assert.ok(!url.includes('latest'), 'latest를 받으면 해시 검증이 무의미해진다');
    assert.equal(isAllowedHost(url), true);
  });

  it('파일명에 버전이 들어가 버전 갱신 시 새로 받는다', () => {
    assert.ok(binaryFileName('linux-x64').includes(CLOUDFLARED_VERSION));
    assert.ok(binaryFileName('win32-x64').endsWith('.exe'));
    assert.ok(!binaryFileName('linux-x64').endsWith('.exe'));
  });
});

describe('해시 비교', () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-bridge-hash-'));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('파일 내용의 SHA256을 계산한다', async () => {
    const file = path.join(dir, 'blob');
    const payload = crypto.randomBytes(4096);
    await fs.writeFile(file, payload);

    const expected = crypto.createHash('sha256').update(payload).digest('hex');
    assert.equal(sha256(await fs.readFile(file)), expected);
  });

  it('한 바이트만 달라도 불일치', () => {
    const a = sha256(Buffer.from('cloudflared'));
    const b = sha256(Buffer.from('cloudflareD'));
    assert.equal(hashMatches(a, b), false);
    assert.equal(hashMatches(a, a), true);
  });

  it('길이가 다른 해시 문자열에서 예외가 나지 않는다', () => {
    assert.equal(hashMatches('abc', 'abcdef'), false);
    assert.equal(hashMatches('', 'a'), false);
  });
});

describe('§6 터널 URL 파싱', () => {
  it('cloudflared 로그에서 Quick Tunnel URL을 찾는다', () => {
    const log = [
      '2026-08-05T01:00:00Z INF +--------------------------------------------+',
      '2026-08-05T01:00:00Z INF |  https://tidy-otter-picks-noon.trycloudflare.com  |',
      '2026-08-05T01:00:00Z INF +--------------------------------------------+'
    ].join('\n');
    assert.equal(parseQuickTunnelUrl(log), 'https://tidy-otter-picks-noon.trycloudflare.com');
  });

  it('URL이 없으면 undefined', () => {
    assert.equal(parseQuickTunnelUrl('INF Starting tunnel'), undefined);
    assert.equal(parseQuickTunnelUrl(''), undefined);
  });

  it('비슷한 도메인에 속지 않는다', () => {
    assert.equal(parseQuickTunnelUrl('https://evil.com/trycloudflare.com'), undefined);
  });
});

describe('§6 재시작 백오프', () => {
  it('2초 → 4초 → 8초', () => {
    assert.equal(backoffDelayMs(0), 2_000);
    assert.equal(backoffDelayMs(1), 4_000);
    assert.equal(backoffDelayMs(2), 8_000);
  });

  it('최대 3회로 제한한다', () => {
    assert.equal(MAX_RESTART_ATTEMPTS, 3);
  });
});

describe('호스트명 정규화', () => {
  it('스킴이 없으면 https를 붙인다', () => {
    assert.equal(normalizeUrl('bridge.example.com'), 'https://bridge.example.com');
  });

  it('이미 스킴이 있으면 그대로 둔다', () => {
    assert.equal(normalizeUrl('https://bridge.example.com'), 'https://bridge.example.com');
  });

  it('끝 슬래시를 제거한다', () => {
    assert.equal(normalizeUrl('https://bridge.example.com/'), 'https://bridge.example.com');
    assert.equal(normalizeUrl(' bridge.example.com// '), 'https://bridge.example.com');
  });
});
