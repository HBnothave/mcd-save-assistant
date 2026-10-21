/**
 * 本地 Mock 麦当劳 MCP Server（用于离线协议自测，无需真实 Token）。
 *
 * 实现 Streamable HTTP MCP 的最小服务端：initialize / notifications/initialized / tools/list / tools/call，
 * 并模拟 401（缺 Token）、429（限流）。运行： node test/mock-server.js
 * 通过 MOCK_PORT 环境变量调整端口，默认 8787。
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8787);

const STATE = { init: 0, sessionCount: 0 };

let seq = 0;
const id = () => ++seq;

function jsonResponse(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body);
}

/// 模拟工具返回（与真实工具同名）
function mockToolResult(name, args = {}) {
  switch (name) {
    case 'list-nutrition-foods':
      return {
        foods: [
          { name: '巨无霸', calories: 514, price: 22.5 },
          { name: '中薯条', calories: 350, price: 12.5 },
          { name: '中杯可乐', calories: 130, price: 9.0 },
          { name: '麦乐鸡（5块）', calories: 280, price: 12.0 },
        ],
      };
    case 'available-coupons':
      return { coupons: [{ couponId: 'C1', name: '满30减5', amount: 5 }] };
    case 'auto-bind-coupons':
      return { bound: 1, message: '已领取 1 张优惠券' };
    case 'query-my-coupons':
      return { coupons: [{ couponId: 'C1', name: '满30减5', amount: 5, expireTime: '2026-12-31' }] };
    case 'query-nearby-stores':
      return { stores: [{ storeId: 'S1', name: '麦当劳(测试门店)', distance: '500m' }] };
    case 'query-meals':
      return {
        meals: [
          { code: '1001', name: '巨无霸', price: 22.5, tags: ['汉堡'] },
          { code: '2001', name: '中薯条', price: 12.5, tags: ['薯条'] },
          { code: '3001', name: '中杯可乐', price: 9.0, tags: ['饮料'] },
        ],
      };
    case 'query-store-coupons':
      return { coupons: [{ couponId: 'S-C1', name: '门店满30减3', amount: 3 }] };
    case 'calculate-price': {
      const items = args.items || [];
      const raw = items.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0);
      const couponCount = Array.isArray(args.coupons) ? args.coupons.length : 0;
      const discount = couponCount > 0 ? Math.min(10, couponCount * 0) + (couponCount > 0 ? 5 : 0) : 0;
      return {
        originalAmount: raw,
        discountAmount: discount,
        totalAmount: Math.max(0, raw - discount),
        items,
      };
    }
    case 'campaign-calendar':
      return { month: '2026-10', activities: [{ name: '疯狂星期三', status: '进行中' }] };
    case 'query-my-account':
      return { availablePoints: 8888, totalPoints: 12000, expiringPoints: 111 };
    case 'mall-points-products':
      return { products: [{ name: '免费巨无霸券', points: 5000 }, { name: '麦乐鸡券', points: 3000 }] };
    case 'now-time-info':
      return { now: new Date().toISOString() };
    default:
      return { message: `mock: 未实现的工具 ${name}`, args };
  }
}

const server = http.createServer((req, res) => {
  // CORS（供浏览器端测试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const auth = req.headers['authorization'] || '';
    // 模拟 401：无 Token 或 Token 非法
    if (!auth.startsWith('Bearer ') || auth === 'Bearer bad') {
      jsonResponse(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'invalid token' } });
      return;
    }
    // 模拟 429：携带 x-mock-429 头的请求
    if (req.headers['x-mock-429']) {
      jsonResponse(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'rate limited' } });
      return;
    }

    let message;
    try {
      message = JSON.parse(body);
    } catch {
      jsonResponse(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }

    const method = message.method;

    // 会话管理：首次 initialize 下发 Session
    let sessionHeader = {};
    if (method === 'initialize' && !STATE.init) {
      STATE.init = 1;
      STATE.sessionCount++;
      sessionHeader = { 'Mcp-Session-Id': `mock-session-${STATE.sessionCount}` };
    }

    // 通知类：无响应，直接 202
    if (method === 'notifications/initialized') {
      res.writeHead(202, sessionHeader);
      res.end();
      return;
    }

    // 初始化类
    if (method === 'ping') {
      jsonResponse(res, 200, { jsonrpc: '2.0', id: message.id, result: {} }, sessionHeader);
      return;
    }
    if (method === 'initialize') {
      jsonResponse(
        res,
        200,
        {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcd-mcp', version: '9.9.9' },
          },
        },
        sessionHeader
      );
      return;
    }
    if (method === 'tools/list') {
      // 从 src/tools.js 的封装反查不现实，这里简单返回一组工具名
      jsonResponse(
        res,
        200,
        {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              'list-nutrition-foods',
              'available-coupons',
              'auto-bind-coupons',
              'query-my-coupons',
              'query-nearby-stores',
              'query-meals',
              'query-store-coupons',
              'calculate-price',
              'campaign-calendar',
              'query-my-account',
              'mall-points-products',
              'now-time-info',
            ].map((name) => ({ name, description: `mock tool ${name}` })),
          },
        },
        sessionHeader
      );
      return;
    }
    if (method === 'tools/call') {
      const { name, arguments: args } = message.params || {};
      const data = mockToolResult(name, args);
      jsonResponse(
        res,
        200,
        {
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
        },
        sessionHeader
      );
      return;
    }

    jsonResponse(
      res,
      200,
      { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${method}` } },
      sessionHeader
    );
  });
});

server.listen(PORT, () => {
  console.log(`Mock McDonald's MCP Server 已启动: http://127.0.0.1:${PORT}`);
});
