/**
 * 麦门省钱助手 · 最小化 Streamable HTTP MCP 客户端
 *
 * 官方对接说明：https://github.com/M-China/mcd-mcp-server
 *  - 服务地址: https://mcp.mcd.cn
 *  - 协议:     Streamable HTTP（JSON-RPC 2.0 over HTTP POST）
 *  - 鉴权:     Authorization: Bearer <MCP_TOKEN>
 *
 * 实现要点（符合 MCP 协议 v2025-03-26）：
 *  - initialize 握手（携带 capability 声明），缓存服务端下发的 Mcp-Session-Id
 *  - 通知 notifications/initialized 完成协议启动
 *  - tools/list 分页拉取全部工具
 *  - tools/call 调用具体工具（请求 JSON，按 URL 决定 per-call session 是否继续携带）
 *  - 兼容服务端返回：纯 JSON 或 JSON Lines / SSE 流式响应
 */

const MCP_SERVER_URL = process.env.MCD_MCP_URL || 'https://mcp.mcd.cn';

let _id = 0;
function nextId() {
  return ++_id;
}

export class McpClient {
  /**
   * @param {object} opts
   * @param {string} opts.token 麦当劳 MCP Token
   * @param {string} [opts.url] 服务地址，默认 https://mcp.mcd.cn
   */
  constructor({ token, url = MCP_SERVER_URL }) {
    if (!token) {
      throw new Error('缺少 MCP Token。请先登录 https://open.mcd.cn/mcp 申请，然后写入 .env 的 MCD_MCP_TOKEN。');
    }
    this.token = token;
    this.url = url;
    this.sessionId = null;
    this._serverInfo = null;
    this._capabilities = null;
  }

  get connected() {
    return !!this._capabilities;
  }

  async _request(method, params = {}, { skipSession = false } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${this.token}`,
    };
    if (this.sessionId && !skipSession) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: nextId(),
      method,
      params,
    });

    let resp;
    try {
      resp = await fetch(this.url, { method: 'POST', headers, body, redirect: 'follow' });
    } catch (e) {
      throw new Error(`无法连接麦当劳 MCP Server（${this.url}）：${e.message}。请检查网络后重试。`);
    }

    // 会话 ID（首次 initialize 时服务端下发）
    const sessionId = resp.headers.get('mcp-session-id');
    if (sessionId) {
      this.sessionId = sessionId;
    }

    if (resp.status === 401) {
      throw new Error('MCP Token 无效、已过期或未提供（HTTP 401）。请到 https://open.mcd.cn/mcp 控制台重新激活并更新 Token。');
    }
    if (resp.status === 429) {
      throw new Error('请求过于频繁，已触发麦当劳 MCP 限流（HTTP 429，每分钟最多 600 次）。请稍后再试。');
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`麦当劳 MCP 返回异常（HTTP ${resp.status}）：${text.slice(0, 300)}`);
    }

    const contentType = resp.headers.get('content-type') || '';
    const raw = await resp.text();

    // —— 1) 纯 JSON 响应 ——
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      return this._parseJson(raw);
    }

    // —— 2) SSE / JSON Lines 流式响应 ——
    return this._parseSse(raw);

    // fallback: 尝试按 JSON 解析
    try { return this._parseJson(raw); } catch { return this._parseSse(raw); }
  }

  _parseJson(raw) {
    const data = JSON.parse(raw);
    if (data.error) {
      throw new Error(`麦当劳 MCP 错误：${data.error.message || JSON.stringify(data.error)}`);
    }
    return data.result;
  }

  _parseSse(raw) {
    let last = null;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        last = JSON.parse(payload);
      }
    }
    if (!last) {
      throw new Error('麦当劳 MCP 返回了空响应，请重试。');
    }
    if (last.error) {
      throw new Error(`麦当劳 MCP 错误：${last.error.message || JSON.stringify(last.error)}`);
    }
    return last.result;
  }

  /** 协议握手：initialize + notifications/initialized */
  async initialize() {
    const result = await this._request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'mcd-save-assistant', version: '1.0.0' },
    }, { skipSession: true });

    this._serverInfo = result?.serverInfo || null;
    this._capabilities = result?.capabilities || {};

    // 启动通知（不期待响应；某些服务端要求带 session，这里显式带）
    await this._request('notifications/initialized', {}, { skipSession: true }).catch(() => {});
    return result;
  }

  /** 拉取全部工具列表 */
  async listTools() {
    const tools = [];
    let cursor = undefined;
    do {
      const params = cursor ? { cursor } : {};
      const result = await this._request('tools/list', params);
      if (result?.tools) tools.push(...result.tools);
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  /**
   * 调用一个 MCP 工具
   * @param {string} name 工具名（见 tools/list）
   * @param {object} args 工具参数
   */
  async callTool(name, args = {}) {
    const result = await this._request('tools/call', { name, arguments: args });
    // 工具结果按 MCP 规范为 content 数组（text / image / resource）
    const texts = [];
    if (result && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text') texts.push(item.text);
        else if (item.type === 'resource' && item.resource?.text) texts.push(String(item.resource.text));
      }
    }
    if (result && result.isError) {
      const msg = texts.join('\n') || '工具执行失败（无详细信息）';
      throw new Error(`工具 ${name} 执行失败：${msg}`);
    }
    return { raw: result, text: texts.join('\n') };
  }
}
