import * as zlib from 'node:zlib';

/**
 * 최소 tar 리더.
 *
 * macOS용 cloudflared는 raw 바이너리가 아니라 `.tgz`로 배포된다
 * (아카이브 안에 `cloudflared` 파일 하나). 이걸 풀려고 `tar` 프로세스를
 * 띄우는 대신 직접 읽는다. 외부 바이너리 의존이 없어야 이 환경에서
 * 테스트할 수 있고, 아카이브가 예상과 다르면 조용히 넘어가는 대신
 * 명시적으로 실패한다.
 *
 * ustar 헤더는 512바이트 고정이고 데이터도 512바이트 경계로 패딩된다.
 */

const BLOCK_SIZE = 512;
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const TYPE_OFFSET = 156;

export class TarError extends Error {}

export interface TarEntry {
  readonly name: string;
  readonly data: Buffer;
}

function readString(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8').trim();
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).replace(/[^0-7]/g, '');
  if (text.length === 0) {
    return 0;
  }
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

/** tar 아카이브에서 일반 파일 엔트리를 모두 읽는다. */
export function readTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) {
      break; // 아카이브 종료 표시
    }

    const name = readString(header, NAME_OFFSET, NAME_LENGTH);
    const size = readOctal(header, SIZE_OFFSET, SIZE_LENGTH);
    const type = String.fromCharCode(header[TYPE_OFFSET] ?? 0);

    offset += BLOCK_SIZE;

    const dataEnd = offset + size;
    if (dataEnd > buffer.length) {
      throw new TarError('The tar archive is truncated');
    }

    // '0' 또는 NUL이 일반 파일. 나머지(디렉터리, 링크, PAX 헤더)는 건너뛴다.
    if (type === '0' || type === '\0') {
      entries.push({ name, data: buffer.subarray(offset, dataEnd) });
    }

    // 데이터는 512바이트 경계까지 패딩된다.
    offset = dataEnd + ((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE);
  }

  return entries;
}

/**
 * gzip으로 압축된 tar에서 파일 하나를 꺼낸다.
 * 이름이 정확히 일치하는 엔트리를 우선하고, 없으면 basename으로 찾는다.
 */
export function extractFileFromTgz(archive: Buffer, fileName: string): Buffer {
  let tarBuffer: Buffer;
  try {
    tarBuffer = zlib.gunzipSync(archive);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TarError(`Failed to decompress the archive: ${reason}`);
  }

  const entries = readTar(tarBuffer);
  const exact = entries.find((entry) => entry.name === fileName);
  if (exact !== undefined) {
    return exact.data;
  }

  const byBasename = entries.find((entry) => entry.name.split('/').pop() === fileName);
  if (byBasename !== undefined) {
    return byBasename.data;
  }

  throw new TarError(
    `Could not find ${fileName} in the archive (entries: ${entries
      .map((entry) => entry.name)
      .join(', ')})`
  );
}
