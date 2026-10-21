/**
 * 麦门省钱引擎（纯逻辑层，可单测）
 *
 * 职责：
 *  1. 解析用户的“想吃清单”（自然语言关键词 → 菜单编码），支持模糊匹配
 *  2. 在目标门店可售卖列表中，从“想要的商品”出发，生成待计算购物篮
 *  3. 结合用户可用优惠券，枚举组合并调用 calculate-price 计算，返回“最省”方案
 *
 * 设计原则：展示逻辑与计算/解析逻辑分离，本文件不依赖 CLI 与网络，便于单元测试。
 */

/**
 * 在餐品列表中模糊匹配一个用户输入的关键词。
 * 匹配优先级：别名精确 > 名称包含 > 拼音/标签。
 * @param {Array} meals          query-meals 返回的餐品列表
 * @param {string} keyword       用户输入，例如 "巨无霸"、"薯条"、"可乐"
 * @returns {Array<object>} 命中的餐品（按相似度排序）
 */
export function matchMeals(meals, keyword) {
  if (!Array.isArray(meals)) return [];
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return [];

  const scored = [];
  for (const meal of meals) {
    const name = String(meal.name || meal.mealName || '').toLowerCase();
    const code = String(meal.code || meal.mealCode || meal.productCode || '').toLowerCase();
    const tags = [meal.tags, meal.labels, meal.tagList]
      .flat()
      .filter(Boolean)
      .map((t) => String(t).toLowerCase());

    let score = 0;
    if (code && code === kw) score = 100;
    else if (name === kw) score = 90;
    else if (name.includes(kw)) score = 70;
    else if (name.startsWith(kw)) score = 68;
    else {
      // 核心短语匹配：去掉名称中的“汉堡/卷/套餐”等后，仍包含关键词主体
      // 例如 kw="麦辣鸡腿堡" 命中 "麦辣鸡腿汉堡"（去“汉”）
      const normalized = name.replace(/套餐|汉堡|堡|卷/g, '');
      const kwNormalized = kw.replace(/套餐|汉堡|堡|卷/g, '');
      if (kwNormalized.length >= 1 && normalized.includes(kwNormalized)) score = 62;
    }
    if (score > 0) {
      // 微弱得分（核心短语）低于标签匹配
      if (tags.some((t) => t === kw) && score < 60) score = 60;
      else if (tags.some((t) => t.includes(kw)) && score < 40) score = 40;
      scored.push({ meal, score, name: meal.name || meal.mealName });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.meal);
}

/**
 * 解析麦当劳 `query-meals` 返回（真实结构）：
 *   data.categories[].meals[]  → 各分类餐品 code 列表
 *   data.meals.{code}          → 餐品详情映射（name / currentPrice / originalPrice / tags / image ...）
 * 展平为一个统一餐品列表，便于模糊匹配与价格计算。
 *
 * @param {object} json 解析后的 JSON 对象
 * @returns {Array<object>} [{ code, name, category, currentPrice, originalPrice, tags, image }]
 */
export function parseMeals(json) {
  const root = json?.data || json || {};
  const detailMap = root.meals || {};
  const categories = Array.isArray(root.categories) ? root.categories : [];

  const out = [];
  const seen = new Set();

  for (const cat of categories) {
    const catName = (cat.name || '').trim();
    for (const m of cat.meals || []) {
      const code = String(m.code || '');
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const detail = detailMap[code] || {};
      out.push({
        code,
        name: detail.name || m.name || `餐品${code}`,
        category: catName,
        currentPrice: detail.currentPrice != null ? Number(detail.currentPrice) : null,
        originalPrice: detail.originalPrice != null ? Number(detail.originalPrice) : null,
        discountType: detail.discountType || null,
        image: detail.image || null,
        tags: m.tags || detail.tags || [],
      });
    }
  }

  // 常点餐品（frequent）作为补充
  const frequent = root.frequent;
  if (frequent && !Array.isArray(frequent) && frequent.code) {
    const code = String(frequent.code);
    if (!seen.has(code)) {
      seen.add(code);
      const detail = detailMap[code] || {};
      out.push({
        code,
        name: detail.name || frequent.name || `餐品${code}`,
        category: '常点',
        currentPrice: detail.currentPrice != null ? Number(detail.currentPrice) : null,
        originalPrice: detail.originalPrice != null ? Number(detail.originalPrice) : null,
        discountType: detail.discountType || null,
        image: detail.image || null,
        tags: frequent.tags || detail.tags || [],
      });
    }
  }

  return out;
}

/**
 * 根据“想要的商品关键词列表”，从门店售卖列表构造购物篮（标准结构，供 calculate-price 使用）。
 * calculate-price 的商品项字段以麦当劳官方返回为准，这里统一映射常见字段名。
 * @param {Array} meals 门店售卖餐品列表
 * @param {string[]} keywords 用户想吃的东西（如 ["巨无霸","薯条","可乐"]）
 * @param {object} [opts]
 * @param {number} [opts.maxPerKeyword=3] 每个关键词最多候选数量
 * @returns {{basket: object[], missing: string[]}}
 */
export function buildBasket(meals, keywords, { maxPerKeyword = 3, preferCodes = null } = {}) {
  const missing = [];
  const picks = [];
  const preferred = preferCodes instanceof Set ? preferCodes : new Set();

  for (const kw of keywords) {
    const hits = matchMeals(meals, kw);
    if (hits.length === 0) {
      missing.push(kw);
      continue;
    }
    // “省钱优先”：若其中有享受优惠（有对应券）的候选，优先选它（最多 1 个），
    // 其余仍作为备选（避免组合爆炸，取前 N 个）
    const preferredHits = hits.filter((m) => preferred.has(String(m.code || m.productCode || '')));
    const chosen = preferredHits.length ? preferredHits.slice(0, 1) : hits.slice(0, maxPerKeyword);
    for (const hit of chosen.slice(0, maxPerKeyword)) {
      picks.push(normalizeCartItem(hit));
    }
  }
  return { basket: picks, missing };
}

/** 把 query-meals 的餐品对象规整为购物篮条目（兼容多种返回字段） */
export function normalizeCartItem(meal) {
  // calculate-price/create-order 的购物项字段为 productCode
  const item = {
    code: meal.code || meal.mealCode || meal.productCode || meal.skuCode || meal.id,
    productCode: meal.code || meal.mealCode || meal.productCode || meal.skuCode || meal.id,
    name: meal.name || meal.mealName || meal.productName || '未知餐品',
    quantity: meal.quantity || 1,
  };
  // 可替换/可加购字段尽量透传，避免丢信息
  for (const k of ['price', 'currentPrice', 'specifications', 'options', 'attrs', 'isMeal', 'tags']) {
    if (meal[k] !== undefined) item[k] = meal[k];
  }
  return item;
}

/**
 * 从 calculate-price 返回中解析应付总额（兼容多字段）。
 * 麦当劳 MCP 官方返回：data.productPrice / data.originalPrice / data.discount / data.price（单位：分）。
 * @returns {{original: number|null, payable: number|null, discount: number|null, fee: number|null, cents: boolean}}
 */
export function parsePriceResult(json) {
  const root = json?.data ?? json ?? {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // 若命中“单位分”字段（price/originalPrice/discount），需转元
  const hasCents = root.price !== undefined || root.originalPrice !== undefined || root.productPrice !== undefined || root.productOriginalPrice !== undefined;
  const cent2yuan = (v) => (v == null ? null : num(v) / 100);
  const fen = (v) => num(v);
  const money = hasCents ? cent2yuan : fen;

  return {
    total: money(root.totalAmount ?? root.price ?? root.payableAmount ?? root.orderAmount),
    original: money(root.originalAmount ?? root.originalPrice ?? root.goodsAmount ?? root.totalPrice),
    discount: money(root.discountAmount ?? root.discount ?? root.couponDiscount),
    deliveryFee: money(root.deliveryFee ?? root.deliveryPrice ?? root.deliveryAmount ?? root.freight),
    payable: money(root.payAmount ?? root.price ?? root.payable ?? root.finalAmount ?? root.actualAmount),
    cents: hasCents,
    raw: root,
  };
}

/** 排序比较：金额小的优先；金额相同的先比较是否用了券 */
export function comparePlan(a, b) {
  const aPay = a.payable ?? a.total ?? Number.POSITIVE_INFINITY;
  const bPay = b.payable ?? b.total ?? Number.POSITIVE_INFINITY;
  if (aPay !== bPay) return aPay - bPay;
  return (b.couponsUsed?.length || 0) - (a.couponsUsed?.length || 0);
}

/**
 * 简单中位数/最省汇总：给出一组方案，返回金额字段抽取成功的方案（过滤无效值）。
 */
export function filterValidPlans(plans) {
  return (plans || []).filter((p) => {
    const v = p.payable ?? p.total;
    return v != null && Number.isFinite(Number(v));
  });
}

/**
 * 解析麦当劳 MCP `list-nutrition-foods` 返回的自定义分隔表格格式。
 *
 * 实际返回示例（data 字符串）：
 *   "[160]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n
 *     猪柳麦满分,null,1288,308,16,16,24,781,213\n
 *     中薯条,null,1210,289,4,12,38,165,18\n..."
 *
 * 格式：`[数量]{列名,逗号分隔}:\n` + 每行 `  名称,null,v1,v2,...`（前导空格 + 逗号分隔）。
 * @param {string} data 返回的 data 字符串
 * @param {object} [opts]
 * @param {string} [opts.nameField='productName'] 名称列
 * @param {string} [opts.calorieField='energyKcal'] 热量列（kcal）
 * @param {string} [opts.priceField] 价格列（如有）
 * @returns {Array<object>} 规范化条目数组
 */
export function parseNutritionTable(data, { nameField = 'productName', calorieField = 'energyKcal', priceField = 'cost' } = {}) {
  if (typeof data !== 'string') return [];
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // 形如 [160]{col1,col2}: 的头部
  const headerMatch = data.match(/\[\d+\]\s*\{([^}]*)\}\s*:\s*\n?([\s\S]*)$/);
  if (!headerMatch) return [];

  const columns = headerMatch[1].split(',').map((c) => c.trim()).filter(Boolean);
  const body = headerMatch[2];

  const items = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const values = trimmed.split(',').map((v) => {
      const s = v.trim();
      return s === 'null' || s === '' ? null : s;
    });
    if (values.length < 2) continue;
    const rec = {};
    columns.forEach((col, i) => {
      rec[col] = values[i] !== undefined ? values[i] : null;
    });
    // 名称与热量是必须的
    const name = rec[nameField];
    if (!name) continue;
    items.push({
      name: String(name),
      calories: num(rec[calorieField]),
      cost: priceField ? (rec[priceField] !== null && rec[priceField] !== undefined ? num(rec[priceField]) : 0) : 0,
      energyKj: rec.energyKj !== null && rec.energyKj !== undefined ? num(rec.energyKj) : 0,
      protein: rec.protein !== null && rec.protein !== undefined ? num(rec.protein) : null,
      fat: rec.fat !== null && rec.fat !== undefined ? num(rec.fat) : null,
      carbohydrate: rec.carbohydrate !== null && rec.carbohydrate !== undefined ? num(rec.carbohydrate) : null,
      sodium: rec.sodium !== null && rec.sodium !== undefined ? num(rec.sodium) : null,
      calcium: rec.calcium !== null && rec.calcium !== undefined ? num(rec.calcium) : null,
      raw: rec,
    });
  }
  return items;
}

/**
 * 营养搭配：基于 list-nutrition-foods 的结果，在给定热量预算内给出组合建议。
 * 采用贪心：按“每千卡价格”或用户指定偏好挑选。字段以官方返回为准，这里做兼容去重。
 * @param {Array} foods 营养餐品列表
 * @param {number} calorieBudget 热量预算（kcal）
 * @param {object} [opts]
 * @param {'min_cost'|'balanced'} [opts.strategy='min_cost']
 * @returns {object} { selected: [], totalCalories, totalCost }
 */
export function planNutrition(foods, calorieBudget, { strategy = 'min_cost' } = {}) {
  const items = (foods || [])
    .map((f) => ({
      ...f,
      name: f.name || f.foodName || f.mealName || '未知',
      calories: Number(f.calories ?? f.kcal ?? f.energy ?? f.energyKcal ?? 0),
      cost: Number(f.price ?? f.cost ?? 0),
    }))
    .filter((f) => f.name && f.calories > 0);

  // 按名称去重（营养库存在重复行）
  const byName = new Map();
  for (const f of items) {
    if (!byName.has(f.name)) byName.set(f.name, f);
  }
  const uniq = [...byName.values()];

  // 按热量预算过滤
  const affordable = uniq.filter((f) => f.calories <= calorieBudget);
  let pool = affordable.length ? affordable : uniq;

  // 无价格数据（cost 全为 0）时自动降级为 balanced（靠近 200 kcal/份），保证组合合理
  const hasPrice = pool.some((f) => f.cost > 0);
  const effectiveStrategy = !hasPrice ? 'balanced' : strategy;

  // 排序策略
  pool = [...pool].sort((a, b) => {
    if (effectiveStrategy === 'min_cost') {
      const perA = a.cost / a.calories;
      const perB = b.cost / b.calories;
      return perA - perB || a.cost - b.cost;
    }
    // balanced：靠近 200kcal/份 的优先
    const dist = (x) => Math.abs(x.calories - 200);
    return dist(a) - dist(b) || a.cost - b.cost;
  });

  let used = calorieBudget;
  const selected = [];
  let totalCalories = 0;
  let totalCost = 0;

  for (const f of pool) {
    if (selected.length >= 20) break;
    // 只当剩余预算放得下至少一份时才加入，避免强塞导致超预算
    const maxQty = Math.floor(used / f.calories);
    if (maxQty < 1) continue;
    const qty = Math.min(3, maxQty); // 单个餐品最多 3 份，合理
    selected.push({ name: f.name, calories: f.calories, cost: f.cost, quantity: qty, hasPrice });
    const kcal = f.calories * qty;
    used -= kcal;
    totalCalories += kcal;
    totalCost += f.cost * qty;
    if (used <= 0) break;
  }
  return { selected, totalCalories, totalCost, hasPrice };
}
