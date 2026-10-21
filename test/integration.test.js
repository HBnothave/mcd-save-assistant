import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { McpClient } from '../src/mcp-client.js';

const PORT = 8791;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

// 项目根目录（Windows 兼容）
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let serverProc = null;

before(async () => {
  serverProc = spawn(process.execPath, ['test/mock-server.js'], {
    cwd: ROOT,
    env: { ...process.env, MOCK_PORT: String(PORT) },
    stdio: 'ignore',
    windowsHide: true,
  });
  // 等待服务可用
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(SERVER_URL, { method: 'OPTIONS' });
      if (r.status !== 404) break;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(() => {
  if (serverProc) serverProc.kill();
});

test('MCP 客户端握手 + tools/list + tools/call 全流程（mock）', async () => {
  const client = new McpClient({ token: 'test-token', url: SERVER_URL });
  const info = await client.initialize();
  assert.equal(info?.serverInfo?.name, 'mock-mcd-mcp');
  assert.ok(client.connected);

  const tools = await client.listTools();
  assert.ok(tools.length >= 12);
  assert.ok(tools.some((t) => t.name === 'calculate-price'));

  // 直接走 client.callTool 验证返回解析
  const r = await client.callTool('calculate-price', {
    items: [
      { code: '1001', price: 22.5, quantity: 1 },
      { code: '2001', price: 12.5, quantity: 1 },
      { code: '3001', price: 9.0, quantity: 1 },
    ],
  });

  assert.ok(r.text.length > 0);
  const parsed = JSON.parse(r.text);
  assert.equal(parsed.originalAmount, 44);
});

test('MCP 客户端 401 报错提示', async () => {
  const client = new McpClient({ token: 'bad', url: SERVER_URL });
  await assert.rejects(() => client.initialize(), /401/);
});
