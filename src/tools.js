import { McpClient } from './mcp-client.js';

/**
 * 从 MCP 工具返回的文本中尽力提取 JSON。
 * 麦当劳 MCP 多数工具以 JSON 文本返回，个别返回自然语言，这里做兼容。
 * @param {string} text
 * @returns {any|null} 解析成功返回对象/数组，否则 null
 */
export function extractJson(text) {
  if (!text) return null;
  const t = String(text).trim();
  // 1) 整体即 JSON
  try { return JSON.parse(t); } catch { /* continue */ }

  // 2) 从 ```json ... ``` 代码块提取
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* continue */ }
  }

  // 3) 从可能包裹的字符串中找第一个 { 或 [ 到末尾
  for (const open of ['{', '[']) {
    const start = t.indexOf(open);
    if (start >= 0) {
      const slice = t.slice(start);
      try {
        const data = JSON.parse(slice);
        return data;
      } catch {
        // 尝试平衡括号截断（处理尾部说明文字）
        const balanced = tryBalance(slice);
        if (balanced) {
          try { return JSON.parse(balanced); } catch { /* continue */ }
        }
      }
    }
  }
  return null;
}

function tryBalance(s) {
  const openChar = s[0];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}

/** 圆整金额（元，两位小数） */
export function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return `¥${n.toFixed(2)}`;
}

/** 中文字符串格式化 */
export function fmtList(arr, field) {
  if (!Array.isArray(arr)) return '--';
  return arr.map((x) => (field ? x?.[field] : x)).filter(Boolean).join('、') || '--';
}

/**
 * 构造一套“结构化解构”的读取：尝试把工具返回解析为 JSON；
 * 若失败则原样返回文本（fallback），供 CLI 展示。
 */
export class ToolResult {
  constructor({ name, text, json }) {
    this.name = name;
    this.text = text || '';
    this.json = json ?? extractJson(text);
  }

  get isJson() {
    return this.json !== null;
  }

  /** 从 JSON 中取一个数组字段（兼容多种路径） */
  arrayOf(...paths) {
    if (!this.json) return [];
    for (const p of paths) {
      const v = dig(this.json, p);
      if (Array.isArray(v)) return v;
    }
    return [];
  }

  get rawText() {
    return this.text;
  }
}

export function dig(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/**
 * 打包一组麦当劳 MCP 工具调用封装。
 * 每个方法：调用 → ToolResult。
 */
export function createTools(mcp) {
  const call = async (name, args = {}) => {
    const { text } = await mcp.callTool(name, args);
    return new ToolResult({ name, text });
  };

  return {
    // ---- 营养 ----
    listNutritionFoods(args = {}) {
      return call('list-nutrition-foods', args);
    },
    // ---- 配送/门店 ----
    queryDeliveryAddresses() {
      return call('delivery-query-addresses');
    },
    createDeliveryAddress(args) {
      return call('delivery-create-address', args);
    },
    queryDeliveryStores(args) {
      return call('delivery-query-stores', args);
    },
    queryNearbyStores(args) {
      return call('query-nearby-stores', args);
    },
    queryMeals(args) {
      return call('query-meals', args);
    },
    queryMealDetail(args) {
      return call('query-meal-detail', args);
    },
    queryStoreCoupons(args) {
      return call('query-store-coupons', args);
    },
    // ---- 价格/订单 ----
    calculatePrice(args) {
      return call('calculate-price', args);
    },
    createOrder(args) {
      return call('create-order', args);
    },
    cancelOrder(args) {
      return call('cancel-order', args);
    },
    queryOrder(args) {
      return call('query-order', args);
    },
    orderList(args) {
      return call('order-list', args);
    },
    // ---- 营销 ----
    campaignCalendar(args = {}) {
      return call('campaign-calendar', args);
    },
    // ---- 麦麦省/券 ----
    availableCoupons(args = {}) {
      return call('available-coupons', args);
    },
    autoBindCoupons(args = {}) {
      return call('auto-bind-coupons', args);
    },
    queryMyCoupons(args = {}) {
      return call('query-my-coupons', args);
    },
    // ---- 积分 ----
    queryMyAccount() {
      return call('query-my-account');
    },
    mallPointsProducts(args = {}) {
      return call('mall-points-products', args);
    },
    mallProductDetail(args) {
      return call('mall-product-detail', args);
    },
    mallCreateOrder(args) {
      return call('mall-create-order', args);
    },
    // ---- 时间/抽奖 ----
    nowTimeInfo() {
      return call('now-time-info');
    },
    queryLotteryInfo() {
      return call('query-lottery-info');
    },
  };
}
