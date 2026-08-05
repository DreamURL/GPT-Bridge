import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpHttpServer, MCP_ENDPOINT, PortInUseError } from '../src/mcp/http';

/**
 * MCP HTTP 계층 통합 테스트.
 *
 * 확장 호스트 없이 돌린다. 툴은 vscode에 의존하지 않는 더미를 쓰고,
 * 검증 대상은 인증·바인딩·메서드 제한이다 (project.md §5.1, §5.2, §11).
 */

const TOKEN = 'a'.repeat(64);

const silentLog = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined
};

function createDummyServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  server.registerTool(
    'echo',
    { description: '테스트용', inputSchema: { value: z.string() } },
    ({ value }) => ({ content: [{ type: 'text', text: value }] })
  );
  return server;
}

/**
 * getToken을 통째로 받는다. `token?: string = TOKEN` 형태로 두면
 * 명시적으로 넘긴 undefined가 기본값으로 되돌아가 '토큰 미설정' 경로를
 * 전혀 검증하지 못한다.
 */
function makeServer(getToken: () => string | undefined = () => TOKEN): McpHttpServer {
  return new McpHttpServer({
    port: 0, // 임의의 빈 포트
    getToken,
    createServer: createDummyServer,
    log: silentLog
  });
}

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' }
  }
});

function mcpHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

let http: McpHttpServer;
let base: string;

before(async () => {
  http = makeServer();
  const port = await http.start();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await http.stop();
});

describe('§5.1 인증', () => {
  it('토큰이 없으면 401', async () => {
    const res = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: mcpHeaders(),
      body: INITIALIZE_BODY
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
  });

  it('잘못된 토큰이면 401', async () => {
    const res = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: mcpHeaders('b'.repeat(64)),
      body: INITIALIZE_BODY
    });
    assert.equal(res.status, 401);
  });

  it('길이가 다른 토큰이어도 예외 없이 401', async () => {
    const res = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: mcpHeaders('short'),
      body: INITIALIZE_BODY
    });
    assert.equal(res.status, 401);
  });

  it('Bearer 형식이 아니면 401', async () => {
    const res = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: { ...mcpHeaders(), authorization: `Basic ${TOKEN}` },
      body: INITIALIZE_BODY
    });
    assert.equal(res.status, 401);
  });

  it('401 본문은 실패 사유를 구분해 알려주지 않는다', async () => {
    const missing = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: mcpHeaders(),
      body: INITIALIZE_BODY
    });
    const wrong = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: mcpHeaders('b'.repeat(64)),
      body: INITIALIZE_BODY
    });
    assert.deepEqual(await missing.json(), await wrong.json());
  });

  it('올바른 토큰이면 initialize가 성공한다', async () => {
    const res = await fetch(`${base}${MCP_ENDPOINT}`, {
      method: 'POST',
      headers: mcpHeaders(TOKEN),
      body: INITIALIZE_BODY
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('serverInfo'), `initialize 응답이 아님: ${text.slice(0, 200)}`);
    assert.ok(text.includes('protocolVersion'));
  });

  it('서버에 토큰이 설정되지 않았으면 모든 요청이 401', async () => {
    const tokenless = makeServer(() => undefined);
    const port = await tokenless.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}${MCP_ENDPOINT}`, {
        method: 'POST',
        headers: mcpHeaders(TOKEN),
        body: INITIALIZE_BODY
      });
      assert.equal(res.status, 401);
    } finally {
      await tokenless.stop();
    }
  });
});

describe('§5.2 바인딩과 메서드 제한', () => {
  it('무상태 모드이므로 GET / DELETE는 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${base}${MCP_ENDPOINT}`, {
        method,
        headers: mcpHeaders(TOKEN)
      });
      assert.equal(res.status, 405, `${method}가 405가 아님`);
      assert.equal(res.headers.get('allow'), 'POST');
    }
  });

  it('GET / DELETE도 인증을 먼저 요구한다', async () => {
    const res = await fetch(`${base}${MCP_ENDPOINT}`, { method: 'GET' });
    assert.equal(res.status, 401);
  });

  it('헬스체크는 인증 없이 열려 있고 상태만 반환한다', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('x-powered-by 헤더를 노출하지 않는다', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('같은 포트를 두 번 점유하면 PortInUseError', async () => {
    const first = new McpHttpServer({
      port: 0,
      getToken: () => TOKEN,
      createServer: createDummyServer,
      log: silentLog
    });
    const port = await first.start();

    const second = new McpHttpServer({
      port,
      getToken: () => TOKEN,
      createServer: createDummyServer,
      log: silentLog
    });

    try {
      await assert.rejects(() => second.start(), PortInUseError);
    } finally {
      await first.stop();
    }
  });

  it('stop 후에는 연결을 받지 않는다', async () => {
    const temp = makeServer();
    const port = await temp.start();
    await temp.stop();

    await assert.rejects(() => fetch(`http://127.0.0.1:${port}/health`));
  });
});

describe('§5.2 레이트리밋', () => {
  it('분당 120회를 넘기면 429', async () => {
    const limited = makeServer();
    const port = await limited.start();

    try {
      let lastStatus = 0;
      for (let i = 0; i < 125; i += 1) {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        lastStatus = res.status;
        await res.arrayBuffer();
      }
      assert.equal(lastStatus, 429);
    } finally {
      await limited.stop();
    }
  });
});
