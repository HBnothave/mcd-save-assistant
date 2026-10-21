import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  matchMeals,
  buildBasket,
  normalizeCartItem,
  parsePriceResult,
  comparePlan,
  filterValidPlans,
  planNutrition,
} from '../src/engine.js';
import { extractJson } from '../src/tools.js';
import { demoData, demoBestPlan } from '../src/demo-data.js';

test('matchMeals 精确名称命中', () => {
  const hits = matchMeals(demoData.meals, '巨无霸');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].code, '1001');
});

test('matchMeals 模糊包含命中', () => {
  const hits = matchMeals(demoData.meals, '薯条');
  assert.ok(hits.length >= 2);
});

test('matchMeals 空输入返回空', () => {
  assert.equal(matchMeals(demoData.meals, '').length, 0);
  assert.equal(matchMeals([], '巨无霸').length, 0);
});

test('buildBasket 构造购物篮并报告缺失项', () => {
  const { basket, missing } = buildBasket(demoData.meals, ['巨无霸', '薯条', '橙汁', '没有的东西']);
  assert.equal(missing.join(','), '没有的东西');
  assert.ok(basket.length >= 3);
  assert.ok(basket.every((b) => b.code));
});

test('normalizeCartItem 字段兼容', () => {
  const item = normalizeCartItem({ mealCode: 'X1', mealName: '测试', quantity: 2 });
  assert.equal(item.code, 'X1');
  assert.equal(item.name, '测试');
  assert.equal(item.quantity, 2);
});

test('parsePriceResult 兼容多种字段', () => {
  const r1 = parsePriceResult({ totalAmount: 30, discountAmount: 5 });
  assert.equal(r1.total, 30);
  assert.equal(r1.discount, 5);

  const r2 = parsePriceResult({ payAmount: 12.5, originalAmount: 20, deliveryFee: 3 });
  assert.equal(r2.payable, 12.5);
  assert.equal(r2.original, 20);
  assert.equal(r2.deliveryFee, 3);

  const r3 = parsePriceResult(null);
  assert.equal(r3.total, null);
});

test('comparePlan 金额小的优先', () => {
  const a = { payable: 20 };
  const b = { payable: 15 };
  assert.equal(comparePlan(a, b) > 0, true);
  assert.equal(comparePlan(b, a) < 0, true);
});

test('filterValidPlans 过滤无效', () => {
  const plans = [
    { label: 'a', payable: 20 },
    { label: 'b', total: '15' },
    { label: 'c', payable: null },
    { label: 'd' },
  ];
  const valid = filterValidPlans(plans);
  assert.equal(valid.length, 2);
});

test('planNutrition 热量预算内给出组合', () => {
  const plan = planNutrition(demoData.foods, 600, { strategy: 'min_cost' });
  assert.ok(plan.totalCalories <= 610); // 允许最后一轮微量超预算
  assert.ok(plan.selected.length > 0);
});

test('planNutrition 空输入安全', () => {
  const plan = planNutrition([], 500);
  assert.equal(plan.selected.length, 0);
  assert.equal(plan.totalCalories, 0);
});

test('demoBestPlan 优惠后价格应小于原价', () => {
  const plans = demoBestPlan();
  assert.ok(plans[2].payable < plans[0].payable);
});

test('extractJson 兼容代码块与前后缀', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('结果如下：{"items":[1,2,3]} 请查收'), { items: [1, 2, 3] });
  assert.deepEqual(extractJson('{"x": "文字"} 结束'), { x: '文字' });
  assert.equal(extractJson('没有任何 JSON'), null);
  assert.equal(extractJson(null), null);
});

test('extractJson 平衡括号截断', () => {
  const s = '{"score": 95, "note": "非常推荐"} \n补充说明文字';
  const out = extractJson(s);
  assert.deepEqual(out, { score: 95, note: '非常推荐' });
});
