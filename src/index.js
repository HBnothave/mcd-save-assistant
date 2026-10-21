#!/usr/bin/env node
/**
 * 麦门省钱助手 CLI 入口
 *
 * 用法：
 *   node src/index.js <command> [options]
 *
 * 命令：
 *   status    检查 MCP 连接与 Token 是否有效
 *   tools     列出所有麦当劳 MCP 工具
 *   coupons   麦麦省一键领券 + 展示我的优惠券
 *   save      最优凑单省钱（核心）：输入想吃的东西 → 自动算最省方案
 *   nutrition 营养搭配：给定热量预算 → 推荐组合
 *   campaign  查询本月活动日历
 *   points    我的积分 + 积分商城
 *   stores    查询附近门店
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// 轻量 .env 加载（零依赖）
function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2').trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadEnv();

const { McpClient } = await import('./mcp-client.js');
const { createTools, money, fmtList } = await import('./tools.js');
const { buildBasket, comparePlan, filterValidPlans, planNutrition, parsePriceResult, matchMeals } =
  await import('./engine.js');

const BANNER = `
🍔 麦门省钱助手 (MCD Save Assistant)
    —— 基于麦当劳 MCP 的智能点餐省钱 Skill
`;

const HELP = `
用法：
  mcd-save <command> [options]

命令：
  status    检查 MCP 连接与 Token 是否有效
  tools     列出所有麦当劳 MCP 工具
  coupons   麦麦省一键领券并展示我的优惠券
  save      核心省钱：输入想吃的东西 → 自动算出最省方案
            （例如：mcd-save save "巨无霸 薯条 可乐"）
  nutrition 营养搭配：给定热量预算推荐组合
            （例如：mcd-save nutrition --kcal 600）
  campaign  查询本月活动日历
  points    我的积分与积分商城
  stores    查询附近门店（默认使用 MCD_DEFAULT_ADDRESS）
  demo      使用内置示例数据演示省钱算法（无需 Token）
  help      显示本帮助

通用选项：
  --json    以 JSON 输出结构化结果
  --store <门店名关键词>   指定门店（save/stores）
`;

function getClient() {
  const token = process.env.MCD_MCP_TOKEN;
  return new McpClient({ token: token && token !== 'YOUR_MCP_TOKEN_HERE' ? token : '' });
}

const NO_TOKEN_MSG =
  '⚠️  未配置有效的 MCP Token。\n' +
  '    1) 打开 https://open.mcd.cn/mcp ，点击右上角【登录】用手机号验证登录\n' +
  '    2) 点击右上角【控制台】→【激活】申请 MCP Token\n' +
  '    3) 将 Token 复制到项目根目录 .env 的 MCD_MCP_TOKEN（参考 .env.example）\n' +
  '    4) 重新运行对应命令';

const rl = readline.createInterface({ input, output });

async function ask(prompt) {
  return rl.question(prompt);
}

/* ---------------- commands ---------------- */

async function cmdStatus(client, { json }) {
  const token = process.env.MCD_MCP_TOKEN;
  if (!token || token === 'YOUR_MCP_TOKEN_HERE') {
    if (json) { console.log(JSON.stringify({ ok: false, reason: 'no_token' })); return 1; }
    console.log(BANNER);
    console.log(NO_TOKEN_MSG);
    return 1;
  }
  const info = await client.initialize();
  if (json) {
    console.log(JSON.stringify({ ok: true, serverInfo: info?.serverInfo, capabilities: info?.capabilities }, null, 2));
    return 0;
  }
  console.log(BANNER);
  console.log('✅ MCP 连接成功！');
  console.log(`   服务端: ${info?.serverInfo?.name || 'mcd-mcp'}  v${info?.serverInfo?.version || '?'}`);
  const tools = await client.listTools();
  console.log(`   可用工具: ${tools.length} 个`);
  return 0;
}

async function cmdTools(client, { json }) {
  const tools = await client.listTools();
  if (json) { console.log(JSON.stringify(tools, null, 2)); return 0; }
  console.log(`📦 麦当劳 MCP 工具列表（共 ${tools.length} 个）：\n`);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const names = [...byName.keys()];
  for (const name of names) {
    const t = byName.get(name);
    console.log(`  • ${name}\n      ${(t.description || '').split('\n')[0]}`);
  }
  return 0;
}

async function cmdCoupons(client, { json, auto }) {
  const t = createTools(client);
  const bound = await t.autoBindCoupons();
  const mine = await t.queryMyCoupons();

  if (json) {
    console.log(JSON.stringify({ bind: bound.json, myCoupons: mine.json, bindText: bound.text, myText: mine.text }, null, 2));
    return 0;
  }

  console.log('\n📢 麦麦省一键领券：');
  if (bound.isJson) {
    console.log('   ' + JSON.stringify(bound.json).slice(0, 2000));
  } else {
    console.log('   ' + bound.rawText.slice(0, 2000));
  }

  console.log('\n🎫 我的优惠券：');
  if (mine.isJson) {
    // 兼容多种返回结构
    const coupons = mine.arrayOf('coupons', 'list', 'data.coupons', 'data.list', 'result');
    if (coupons.length) {
      coupons.forEach((c, i) => {
        const name = c.name || c.couponName || c.title || `券${i + 1}`;
        const amount = c.amount ?? c.value ?? c.discountAmount;
        const expire = c.expireTime || c.validEndTime || c.endTime || '';
        console.log(`  ${i + 1}. ${name}  ${amount !== undefined ? `(${money(amount)})` : ''}  ${expire ? `到期 ${expire}` : ''}`);
      });
    } else {
      console.log('   （JSON 返回，未识别到券列表，原文：' + JSON.stringify(mine.json).slice(0, 800) + '）');
    }
  } else {
    console.log('   ' + mine.rawText.slice(0, 2000));
  }
  return 0;
}

async function cmdSave(client, { json, items, budget, storeKw }) {
  const t = createTools(client);

  let keywords = items ? items.trim().split(/[\s，,、]+/).filter(Boolean) : [];
  if (!keywords.length) {
    console.log('🧾 请输入你想吃的东西（多个用空格/逗号分隔），例如：');
    const line = await ask('   > 巨无霸 薯条 可乐\n');
    keywords = line.trim().split(/[\s，,、]+/).filter(Boolean);
    if (!keywords.length) {
      console.log('未输入内容，已取消。');
      return 1;
    }
  }
  console.log(`🎯 想吃：${keywords.join(' / ')}`);

  // 1) 定位门店
  console.log('\n📍 正在查询附近门店…');
  const addr = process.env.MCD_DEFAULT_ADDRESS;
  let store = null;
  if (addr) {
    const nearby = await t.queryNearbyStores({ address: addr });
    store = pickStore(nearby, storeKw);
  } else {
    const nearRaw = await t.queryNearbyStores();
    store = pickStore(nearRaw, storeKw);
  }
  if (!store) {
    console.log('未能在附近找到可服务门店。请设置 MCD_DEFAULT_ADDRESS 或使用 --store 指定门店。');
    return 1;
  }
  const storeId = store.storeId || store.storeCode || store.id || store.code;
  console.log(`   已选门店: ${store.storeName || store.name || storeId}${storeId ? ` (${storeId})` : ''}`);

  // 2) 拉取门店在售餐品
  console.log('\n🍟 正在拉取门店菜单…');
  const meals = await t.queryMeals({ storeId });
  const mealList = meals.arrayOf('meals', 'list', 'data.meals', 'data.list', 'products', 'data');
  if (!mealList.length) {
    console.log('未识别到餐品列表，原始返回：');
    console.log(meals.rawText.slice(0, 3000));
    return 1;
  }
  console.log(`   在售餐品 ${mealList.length} 款`);

  // 3) 构造购物篮
  const { basket, missing } = buildBasket(mealList, keywords);
  if (missing.length) {
    console.log(`⚠️  未匹配到菜单项：${missing.join('、')}（将按已匹配项计算）`);
  }
  if (!basket.length) {
    console.log('没有在菜单中找到匹配项，尝试放宽：');
    console.log('   菜单含：' + mealList.slice(0, 40).map((m) => m.name || m.mealName).filter(Boolean).join('、'));
    return 1;
  }

  // 4) 计算价格
  console.log('\n💸 正在计算价格与优惠…');
  const results = [];
  // 方案 A：不用券
  try {
    const r = await t.calculatePrice({ items: dedupeForCalc(basket) });
    results.push({ label: '无券', ...parsePriceResult(r.json), raw: r });
  } catch (e) { console.log('   （无券计算失败：' + e.message + '）'); }

  // 方案 B：用券（门店可用券）
  for (const field of ['query-store-coupons']) {
    try {
      const sc = await t.queryStoreCoupons({ storeId });
      const coupons = sc.arrayOf('coupons', 'list', 'data.coupons', 'data.list');
      if (coupons.length) {
        const r = await t.calculatePrice({
          items: dedupeForCalc(basket),
          coupons: coupons.map((c) => c.couponId || c.id || c.code).filter(Boolean),
        });
        results.push({ label: `门店券(${coupons.length})`, ...parsePriceResult(r.json), raw: r });
      }
    } catch (e) { /* 某些环境不支持，继续 */ }
  }

  // 方案 C：我的券
  try {
    const mc = await t.queryMyCoupons();
    const coupons = mc.arrayOf('coupons', 'list', 'data.coupons', 'data.list').filter(Boolean);
    if (coupons.length) {
      const r = await t.calculatePrice({
        items: dedupeForCalc(basket),
        coupons: coupons.map((c) => c.couponId || c.id || c.code).filter(Boolean),
      });
      results.push({ label: `我的券(${coupons.length})`, ...parsePriceResult(r.json), raw: r });
    }
  } catch (e) { /* 继续 */ }

  // 5) 输出最优
  const valid = filterValidPlans(results);
  if (json) {
    console.log(JSON.stringify({
      store: store,
      keywords,
      basket,
      plans: results.map((r) => ({ label: r.label, price: r.payable ?? r.total ?? null, raw: r.raw?.json || r.raw?.text })),
    }, null, 2));
    return 0;
  }

  if (!valid.length) {
    console.log('\n⚠️  未能获得有效的价格结果，原始返回如下：');
    for (const r of results) {
      console.log(`\n--- ${r.label} ---\n${r.raw?.text?.slice(0, 2000) || '空'}`);
    }
    return 1;
  }

  valid.sort(comparePlan);
  const best = valid[0];
  console.log('\n✅ 最优方案：');
  for (const item of basket) {
    console.log(`   • ${item.name} ×${item.quantity || 1}`);
  }
  const bestPay = best.payable ?? best.total;
  if (bestPay != null) console.log(`   应付：   ${money(bestPay)}（方案：${best.label}）`);
  if (best.original != null) console.log(`   原价：   ${money(best.original)}`);
  if (best.discount != null) console.log(`   已优惠： -${money(best.discount)}`);
  if (best.deliveryFee != null && Number(best.deliveryFee) > 0) console.log(`   配送费： ${money(best.deliveryFee)}`);

  console.log('\n📋 全部试算：');
  for (const r of valid) {
    const pay = r.payable ?? r.total;
    console.log(`   ${r.label.padEnd(12)} ${pay != null ? money(pay) : '--'}`);
  }
  return 0;
}

function pickStore(nearby, storeKw) {
  const stores = nearby?.arrayOf('stores', 'list', 'data.stores', 'data.list', 'result') || [];
  if (!stores.length) return null;
  if (storeKw) {
    const hit = matchMeals(stores, storeKw);
    return hit[0] || stores[0];
  }
  return stores[0];
}

/** calculate-price 前对购物篮去重（相同编码合并数量，避免重复计费） */
function dedupeForCalc(basket) {
  const map = new Map();
  for (const it of basket) {
    const key = it.code ?? it.name;
    if (!key) continue;
    if (map.has(key)) map.get(key).quantity = (map.get(key).quantity || 1) + (it.quantity || 1);
    else map.set(key, { ...it });
  }
  return [...map.values()];
}

async function cmdNutrition(client, { json, kcal, target }) {
  const budget = Number(kcal || 600);
  const t = createTools(client);
  const foods = await t.listNutritionFoods();
  const list = foods.arrayOf('foods', 'list', 'data.foods', 'data.list', 'items', 'data');
  const plan = planNutrition(list, budget, { strategy: target === 'balanced' ? 'balanced' : 'min_cost' });

  if (json) {
    console.log(JSON.stringify({ budget, ...plan }, null, 2));
    return 0;
  }
  console.log(`\n🥗 营养搭配（热量预算 ${budget} kcal）：`);
  if (!plan.selected.length) {
    console.log('   （当前营养库未返回可计算数据，以下是原始内容）');
    console.log(foods.rawText.slice(0, 2000));
    return 1;
  }
  for (const s of plan.selected) {
    console.log(`   • ${s.name} ×${s.quantity}  ${s.calories * s.quantity} kcal  ${money(s.cost * s.quantity)}`);
  }
  console.log(`\n   合计：${plan.totalCalories} kcal  /  ${money(plan.totalCost)}`);
  return 0;
}

async function cmdCampaign(client, { json }) {
  const t = createTools(client);
  const r = await t.campaignCalendar();
  if (json) {
    console.log(JSON.stringify(r.json ?? { text: r.text }, null, 2));
    return 0;
  }
  console.log('\n🎉 本月活动日历：');
  if (r.isJson) {
    console.log(JSON.stringify(r.json, null, 2).slice(0, 3000));
  } else {
    console.log(r.rawText.slice(0, 3000));
  }
  return 0;
}

async function cmdPoints(client, { json }) {
  const t = createTools(client);
  const acc = await t.queryMyAccount();
  const mall = await t.mallPointsProducts();
  if (json) {
    console.log(JSON.stringify({ account: acc.json ?? acc.text, mall: mall.json ?? mall.text }, null, 2));
    return 0;
  }
  console.log('\n⭐ 我的积分：');
  if (acc.isJson) {
    const cfg = acc.json;
    const avail = cfg.availablePoints ?? cfg.available ?? cfg.value ?? '--';
    console.log(`   可用积分：${avail}`);
    console.log(`   （原始返回：${JSON.stringify(cfg).slice(0, 500)}）`);
  } else {
    console.log('   ' + acc.rawText.slice(0, 1000));
  }
  console.log('\n🛍️  积分商城：');
  if (mall.isJson) {
    const products = mall.arrayOf('products', 'list', 'data.products', 'data.list', 'items');
    if (products.length) {
      products.slice(0, 10).forEach((p, i) => {
        const name = p.name || p.productName || p.title || `商品${i + 1}`;
        const points = p.points ?? p.pointPrice ?? p.pricePoints;
        console.log(`   ${i + 1}. ${name}  ${points !== undefined ? `${points} 积分` : ''}`);
      });
    } else {
      console.log('   （JSON 返回，未识别到商品列表：' + JSON.stringify(mall.json).slice(0, 500) + '）');
    }
  } else {
    console.log('   ' + mall.rawText.slice(0, 2000));
  }
  return 0;
}

async function cmdStores(client, { json, address }) {
  const t = createTools(client);
  const addr = address || process.env.MCD_DEFAULT_ADDRESS;
  const r = addr ? await t.queryNearbyStores({ address: addr }) : await t.queryNearbyStores();
  if (json) {
    console.log(JSON.stringify(r.json ?? { text: r.text }, null, 2));
    return 0;
  }
  console.log('\n🏪 附近门店：');
  if (r.isJson) {
    const stores = r.arrayOf('stores', 'list', 'data.stores', 'data.list', 'result');
    if (stores.length) {
      stores.forEach((s, i) => {
        const name = s.storeName || s.name || `门店${i + 1}`;
        const id = s.storeId || s.storeCode || s.id || s.code || '';
        const dist = s.distance ?? '';
        console.log(`   ${i + 1}. ${name}${id ? ` (${id})` : ''}${dist ? `  距离${dist}` : ''}`);
      });
    } else {
      console.log(JSON.stringify(r.json, null, 2).slice(0, 2000));
    }
  } else {
    console.log(r.rawText.slice(0, 3000));
  }
  return 0;
}

async function cmdDemo({ json }) {
  const { demoData, demoBestPlan } = await import('./demo-data.js');
  const budget = 600;
  const plan = planNutrition(demoData.foods, budget, { strategy: 'min_cost' });
  const { buildBasket } = await import('./engine.js');
  const basket = buildBasket(demoData.meals, ['巨无霸', '薯条', '可乐']);

  if (json) {
    console.log(JSON.stringify({ nutrition: plan, basket: basket.basket }, null, 2));
    return 0;
  }
  console.log(BANNER);
  console.log('🧪 演示模式（内置示例数据，无需 Token）\n');
  console.log('🥗 营养搭配示例（600 kcal 预算）：');
  for (const s of plan.selected) {
    console.log(`   • ${s.name} ×${s.quantity}  ${s.calories * s.quantity} kcal  ${money(s.cost * s.quantity)}`);
  }
  console.log(`   合计：${plan.totalCalories} kcal / ${money(plan.totalCost)}`);
  const bp = demoBestPlan();
  console.log('\n💰 优惠试算示例：');
  for (const r of bp) {
    console.log(`   ${r.label.padEnd(12)} 原价 ${money(r.original)} → 应付 ${money(r.payable)}`);
  }
  return 0;
}

/* ---------------- main ---------------- */

const USAGE = `用法：mcd-save <command>\n\n${HELP}`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return 0;
  }
  const cmd = args[0] || 'help';

  // 需要 Token 的指令：缺少 Token 时给出友好引导（demo/help 除外）
  const needsToken = ['status', 'tools', 'coupons', 'save', 'nutrition', 'campaign', 'points', 'stores'];
  const token = process.env.MCD_MCP_TOKEN;
  const hasToken = !!token && token !== 'YOUR_MCP_TOKEN_HERE';
  if (needsToken.includes(cmd) && !hasToken) {
    if (args.includes('--json')) {
      if (cmd === 'status') {
        console.log(JSON.stringify({ ok: false, reason: 'no_token' }));
        return 1;
      }
      console.log(JSON.stringify({ ok: false, reason: 'no_token', hint: '登录 https://open.mcd.cn/mcp 获取 Token 后写入 .env' }));
      return 1;
    }
    console.log(BANNER);
    console.log(NO_TOKEN_MSG);
    return 1;
  }

  const json = args.includes('--json');
  const parseFlag = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const items = parseFlag('--items') || parseFlag('--want');
  const kcal = parseFlag('--kcal');
  const targetOption = parseFlag('--target');
  const budget = parseFlag('--budget');
  const storeKw = parseFlag('--store');
  const address = parseFlag('--address');

  try {
    switch (cmd) {
      case 'status': return await cmdStatus(getClient(), { json });
      case 'tools': return await cmdTools(getClient(), { json });
      case 'coupons': return await cmdCoupons(getClient(), { json });
      case 'save': return await cmdSave(getClient(), { json, items, budget, storeKw });
      case 'nutrition': return await cmdNutrition(getClient(), { json, kcal, target: targetOption });
      case 'campaign': return await cmdCampaign(getClient(), { json });
      case 'points': return await cmdPoints(getClient(), { json });
      case 'stores': return await cmdStores(getClient(), { json, address });
      case 'demo': return await cmdDemo({ json });
      case 'help':
      default:
        console.log(USAGE);
        return cmd === 'help' ? 0 : 1;
    }
  } catch (e) {
    console.error('\n❌ ' + e.message);
    return 1;
  } finally {
    rl.close();
  }
}

process.exitCode = await main();
