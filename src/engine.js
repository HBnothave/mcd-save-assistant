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
    else if (tags.some((t) => t === kw)) score = 60;
    else if (tags.some((t) => t.includes(kw))) score = 40;

    if (score > 0) scored.push({ meal, score, name: meal.name || meal.mealName });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.meal);
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
export function buildBasket(meals, keywords, { maxPerKeyword = 3 } = {}) {
  const missing = [];
  const picks = [];

  for (const kw of keywords) {
    const hits = matchMeals(meals, kw);
    if (hits.length === 0) {
      missing.push(kw);
      continue;
    }
    // 为避免组合爆炸，每个关键词最多取前 N 个候选
    for (const hit of hits.slice(0, maxPerKeyword)) {
      picks.push(normalizeCartItem(hit));
    }
  }
  return { basket: picks, missing };
}

/** 把 query-meals 的餐品对象规整为购物篮条目（兼容多种返回字段） */
export function normalizeCartItem(meal) {
  const item = {
    code: meal.code || meal.mealCode || meal.productCode || meal.skuCode || meal.id,
    name: meal.name || meal.mealName || meal.productName || '未知餐品',
    quantity: meal.quantity || 1,
  };
  // 可替换/可加购字段尽量透传，避免丢信息
  for (const k of ['price', 'specifications', 'options', 'attrs', 'isMeal', 'tags']) {
    if (meal[k] !== undefined) item[k] = meal[k];
  }
  return item;
}

/**
 * 从 calculate-price 返回中解析应付总额（兼容多字段）。
 * @returns {{original: number|null, payable: number|null, discount: number|null, fee: number|null}}
 */
export function parsePriceResult(json) {
  const root = json || {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    total: num(root.totalAmount ?? root.total ?? root.payableAmount ?? root.orderAmount),
    original: num(root.originalAmount ?? root.goodsAmount ?? root.totalPrice),
    discount: num(root.discountAmount ?? root.couponDiscount ?? root.discount),
    deliveryFee: num(root.deliveryFee ?? root.deliveryAmount ?? root.freight),
    payable: num(root.payAmount ?? root.payable ?? root.finalAmount ?? root.actualAmount),
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

  // 按热量预算过滤
  const affordable = items.filter((f) => f.calories <= calorieBudget);
  const pool = affordable.length ? affordable : items;

  // 排序策略
  pool.sort((a, b) => {
    if (strategy === 'min_cost') {
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
    selected.push({ name: f.name, calories: f.calories, cost: f.cost, quantity: qty });
    const kcal = f.calories * qty;
    used -= kcal;
    totalCalories += kcal;
    totalCost += f.cost * qty;
    if (used <= 0) break;
  }
  return { selected, totalCalories, totalCost };
}
