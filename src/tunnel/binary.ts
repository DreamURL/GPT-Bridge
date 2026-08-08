import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractFileFromTgz } from './tar';

/**
 * cloudflared 바이너리 확보 (project.md §6.1).
 *
 * 릴리스 버전을 **핀으로 고정**하고 플랫폼별 SHA256을 아래 상수 테이블에
 * 직접 박는다. Cloudflare는 전 플랫폼 체크섬을 일관되게 게시하지 않으므로,
 * 다운로드 페이지에서 해시를 받아 대조하는 방식은 최초 접속을 신뢰하는
 * TOFU로 퇴화한다. 이 커밋 자체가 신뢰 근거다.
 *
 * 버전 갱신은 아래 두 상수를 함께 고치는 것으로만 이루어진다. 자동 업데이트 없음.
 * 해시는 2026-08-05에 각 자산을 내려받아 sha256sum으로 확인했다.
 */
export const CLOUDFLARED_VERSION = '2026.7.3';

/**
 * `${process.platform}-${process.arch}` → 자산 이름과 SHA256.
 *
 * 해시를 둘 다 기록한다.
 *  - assetSha256  : 내려받은 자산 그대로의 해시. 다운로드 직후 검증에 쓴다.
 *  - binarySha256 : 디스크에 놓이는 실행 파일의 해시. 재사용 시 검증에 쓴다.
 * raw 바이너리 배포는 둘이 같고, macOS(.tgz)는 다르다. 이걸 구분하지 않으면
 * 아카이브 플랫폼에서 재사용 검증이 '파일 존재 확인'으로 퇴화한다.
 */
interface AssetSpec {
  readonly asset: string;
  readonly assetSha256: string;
  readonly binarySha256: string;
  /** .tgz면 아카이브 안에서 꺼낼 파일 이름. raw 바이너리면 undefined. */
  readonly archiveMember: string | undefined;
}

const ASSETS: Readonly<Record<string, AssetSpec>> = {
  'linux-x64': {
    asset: 'cloudflared-linux-amd64',
    assetSha256: '9d71c677db00134c1bd4144b7783486b654ad281b1ea62b4972098d19f770f17',
    binarySha256: '9d71c677db00134c1bd4144b7783486b654ad281b1ea62b4972098d19f770f17',
    archiveMember: undefined
  },
  'linux-arm64': {
    asset: 'cloudflared-linux-arm64',
    assetSha256: '65259e652a7bea08bf5df603233ab22b8bf3116af8df9f9206209af6a1b955c0',
    binarySha256: '65259e652a7bea08bf5df603233ab22b8bf3116af8df9f9206209af6a1b955c0',
    archiveMember: undefined
  },
  'darwin-x64': {
    asset: 'cloudflared-darwin-amd64.tgz',
    assetSha256: '70d1c8684fa6d14b5843787ec8d1ea8e18b23650e424f4ea43d849a506487c3b',
    binarySha256: 'e88fe5874d42a94f49a7ea59cabc3722d2962d0449232b0f3b1a426a712e275c',
    archiveMember: 'cloudflared'
  },
  'darwin-arm64': {
    asset: 'cloudflared-darwin-arm64.tgz',
    assetSha256: '90c5a4f914d705fd70c135dba6d80b1791d254b08d6d4136301941f88330dd09',
    binarySha256: 'f35c50089cd25f77a4cb5a2152036bc26db15aa31fbe11f7995d2e42a4ed6257',
    archiveMember: 'cloudflared'
  },
  'win32-x64': {
    asset: 'cloudflared-windows-amd64.exe',
    assetSha256: '8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841',
    binarySha256: '8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841',
    archiveMember: undefined
  }
};

/**
 * 리다이렉트 허용 호스트.
 *
 * GitHub 릴리스 자산은 `github.com` → `release-assets.githubusercontent.com`으로
 * 넘어간다(예전에는 objects.githubusercontent.com이었다. 둘 다 허용한다).
 * 목록에 없는 호스트로 넘어가면 즉시 중단한다.
 */
const ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com'
];

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 180_000;

export class BinaryError extends Error {}

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

/** 이 플랫폼에서 지원하는 자산. 미지원이면 undefined. */
export function assetForPlatform(key: string = platformKey()): AssetSpec | undefined {
  return ASSETS[key];
}

export function downloadUrl(asset: string): string {
  return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`;
}

export function isAllowedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** 해시를 상수 시간으로 비교한다. */
export function hashMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** 파일명은 플랫폼별 버전을 포함해, 버전을 올리면 새로 받도록 한다. */
export function binaryFileName(key: string = platformKey()): string {
  const suffix = key.startsWith('win32') ? '.exe' : '';
  return `cloudflared-${CLOUDFLARED_VERSION}-${key}${suffix}`;
}

export interface DownloadLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * 리다이렉트를 직접 따라가며 매 홉마다 호스트를 검사한다.
 * fetch의 자동 리다이렉트에 맡기면 어디를 거쳤는지 확인할 수 없다.
 */
async function fetchWithHostCheck(startUrl: string, log: DownloadLogger): Promise<Buffer> {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedHost(url)) {
      throw new BinaryError(`Download host is not allowed: ${new URL(url).hostname}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new BinaryError(`Download failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) {
        throw new BinaryError('The redirect response has no Location header');
      }
      url = new URL(location, url).toString();
      log.info(`Redirect -> ${new URL(url).hostname}`);
      continue;
    }

    if (!response.ok) {
      throw new BinaryError(`Download failed: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  throw new BinaryError('Too many redirects');
}

export interface EnsureOptions {
  /** context.globalStorageUri 하위 디렉터리. */
  readonly storageDir: string;
  readonly log: DownloadLogger;
}

/**
 * 바이너리를 확보해 실행 가능한 경로를 돌려준다.
 * 이미 받아 둔 파일이 있으면 해시를 다시 확인하고 재사용한다.
 */
export async function ensureCloudflared(options: EnsureOptions): Promise<string> {
  const key = platformKey();
  const spec = assetForPlatform(key);
  if (spec === undefined) {
    throw new BinaryError(
      `No pinned cloudflared binary is available for this platform (${key}). ` +
        `Install cloudflared yourself, or turn the tunnel off.`
    );
  }

  await fs.mkdir(options.storageDir, { recursive: true });
  const target = path.join(options.storageDir, binaryFileName(key));

  // 이미 있으면 실행 파일 자체의 해시를 다시 확인한다. 디스크에서 바뀌었을 수 있다.
  try {
    const existing = await fs.readFile(target);
    if (hashMatches(sha256(existing), spec.binarySha256)) {
      options.log.info(`Reusing cloudflared ${CLOUDFLARED_VERSION}: ${target}`);
      return target;
    }
    options.log.warn('The existing cloudflared file has a bad hash - downloading again.');
    await fs.rm(target, { force: true });
  } catch {
    // 없으면 아래에서 받는다.
  }

  const url = downloadUrl(spec.asset);
  options.log.info(`Downloading cloudflared ${CLOUDFLARED_VERSION}: ${url}`);
  const payload = await fetchWithHostCheck(url, options.log);

  const actual = sha256(payload);
  if (!hashMatches(actual, spec.assetSha256)) {
    // 재시도로 우회하지 않는다. 즉시 중단한다.
    throw new BinaryError(
      `cloudflared hash mismatch - aborting the download.\n` +
        `expected: ${spec.assetSha256}\nactual: ${actual}`
    );
  }
  options.log.info('SHA256 verification passed');

  const binary =
    spec.archiveMember === undefined
      ? payload
      : extractFileFromTgz(payload, spec.archiveMember);

  // 아카이브에서 꺼낸 실행 파일도 기록된 해시와 대조한다.
  const binaryHash = sha256(binary);
  if (!hashMatches(binaryHash, spec.binarySha256)) {
    throw new BinaryError(
      `The extracted cloudflared binary has a hash mismatch.\n` +
        `expected: ${spec.binarySha256}\nactual: ${binaryHash}`
    );
  }

  // 임시 파일에 쓰고 검증이 끝난 뒤 원자적으로 옮긴다.
  // 부분 다운로드가 유효한 바이너리로 남으면 안 된다.
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, binary, { mode: 0o755 });
  await fs.rename(temp, target);
  await fs.chmod(target, 0o755);

  options.log.info(`cloudflared ready: ${target}`);
  return target;
}
