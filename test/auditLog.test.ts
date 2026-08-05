import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AuditLog } from '../src/audit/AuditLog';
import { redactRoot } from '../src/workspace/redact';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-bridge-audit-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function readRecords(log: AuditLog): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(log.path, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('§5.6 감사 로그', () => {
  it('JSONL 한 줄에 한 건씩 기록한다', async () => {
    const log = new AuditLog({ directory: dir });
    log.append({ kind: 'tool_call', tool: 'read_file', detail: 'src/app.ts', ok: true, durationMs: 12 });
    await log.flush();

    const records = await readRecords(log);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, 'tool_call');
    assert.equal(records[0]?.tool, 'read_file');
    assert.equal(records[0]?.detail, 'src/app.ts');
    assert.equal(records[0]?.ok, true);
    assert.equal(records[0]?.durationMs, 12);
    assert.match(String(records[0]?.ts), /^\d{4}-\d{2}-\d{2}T/);
  });

  it('디렉터리가 없으면 만든다', async () => {
    const nested = path.join(dir, 'a', 'b', 'audit');
    const log = new AuditLog({ directory: nested });
    log.append({ kind: 'server', detail: 'started' });
    await log.flush();

    assert.ok((await readRecords(log)).length === 1);
  });

  it('연달아 넣어도 줄이 섞이지 않는다', async () => {
    const log = new AuditLog({ directory: dir });
    for (let i = 0; i < 200; i += 1) {
      log.append({ kind: 'tool_call', tool: 'read_file', detail: `file-${i}.ts` });
    }
    await log.flush();

    const records = await readRecords(log);
    assert.equal(records.length, 200);
    assert.equal(records[0]?.detail, 'file-0.ts');
    assert.equal(records[199]?.detail, 'file-199.ts');
  });

  it('차단·거부·만료도 남긴다', async () => {
    const log = new AuditLog({ directory: dir });
    log.append({ kind: 'path_denied', tool: 'read_file', detail: '../../etc/passwd', ok: false });
    log.append({ kind: 'approval_denied', tool: 'edit_file', detail: 'src/app.ts', ok: false });
    log.append({ kind: 'approval_expired', tool: 'edit_file', detail: 'src/app.ts', ok: false });
    log.append({ kind: 'expired_choice', tool: 'edit_file', detail: 'src/app.ts', ok: false });
    log.append({ kind: 'auth_failure', detail: '127.0.0.1', ok: false });
    log.append({ kind: 'disk_write', tool: 'delete_path', detail: 'old.ts', ok: true });
    await log.flush();

    const kinds = (await readRecords(log)).map((record) => record.kind);
    assert.deepEqual(kinds, [
      'path_denied',
      'approval_denied',
      'approval_expired',
      'expired_choice',
      'auth_failure',
      'disk_write'
    ]);
  });

  it('긴 detail은 잘라 낸다 (파일 내용이 통째로 들어가면 안 된다)', async () => {
    const log = new AuditLog({ directory: dir });
    log.append({ kind: 'tool_call', tool: 'write_file', detail: 'x'.repeat(5000) });
    await log.flush();

    const detail = String((await readRecords(log))[0]?.detail);
    assert.ok(detail.length < 600, `잘리지 않았다: ${detail.length}자`);
    assert.ok(detail.includes('5000자'));
  });

  it('쓰기에 실패해도 예외를 던지지 않는다', async () => {
    // 파일이 있어야 할 자리에 디렉터리를 만들어 append를 실패시킨다.
    await fs.mkdir(path.join(dir, 'audit.jsonl'), { recursive: true });

    const errors: string[] = [];
    const log = new AuditLog({ directory: dir, onError: (message) => errors.push(message) });

    log.append({ kind: 'tool_call', tool: 'read_file' });
    await log.flush(); // 던지면 여기서 테스트가 실패한다

    assert.equal(errors.length, 1);
    assert.ok(errors[0]?.includes('감사 로그 기록 실패'));
  });

  it('실패 후에도 큐가 계속 동작한다', async () => {
    await fs.mkdir(path.join(dir, 'audit.jsonl'), { recursive: true });
    const errors: string[] = [];
    const log = new AuditLog({ directory: dir, onError: (message) => errors.push(message) });

    log.append({ kind: 'tool_call', tool: 'a' });
    log.append({ kind: 'tool_call', tool: 'b' });
    await log.flush();

    assert.equal(errors.length, 2, '두 번째 기록이 큐에서 유실되었다');
  });
});

describe('오류 메시지에서 워크스페이스 경로 제거', () => {
  it('절대 경로를 <workspace>로 바꾼다', () => {
    const root = '/home/me/proj';
    assert.equal(
      redactRoot(`ENOENT: no such file, open '/home/me/proj/src/app.ts'`, root),
      `ENOENT: no such file, open '<workspace>/src/app.ts'`
    );
  });

  it('Windows 경로도 처리한다', () => {
    const root = 'C:\\Users\\me\\proj';
    assert.equal(
      redactRoot('EPERM: C:\\Users\\me\\proj\\src\\app.ts', root),
      'EPERM: <workspace>\\src\\app.ts'
    );
    // 구분자가 뒤집힌 형태로 나와도 걸러야 한다
    assert.equal(
      redactRoot('EPERM: C:/Users/me/proj/src/app.ts', root),
      'EPERM: <workspace>/src/app.ts'
    );
  });

  it('여러 번 등장해도 모두 바꾼다', () => {
    const root = '/w';
    assert.equal(redactRoot('/w/a → /w/b', root), '<workspace>/a → <workspace>/b');
  });

  it('루트가 비어 있으면 그대로 둔다', () => {
    assert.equal(redactRoot('some error', ''), 'some error');
  });
});
