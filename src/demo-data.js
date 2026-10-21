/**
 * 演示/离线测试用示例数据（与真实麦当劳餐品无关，仅为展示算法）。
 * 仅在 `mcd-save demo` 与单元测试中使用，不需要 MCP Token。
 */

export const demoData = {
  meals: [
    { code: '1001', name: '巨无霸', price: 22.5, tags: ['汉堡'] },
    { code: '1002', name: '双层吉士汉堡', price: 19.5, tags: ['汉堡'] },
    { code: '1003', name: '麦辣鸡腿堡', price: 19.0, tags: ['汉堡', '辣'] },
    { code: '2001', name: '中薯条', price: 12.5, tags: ['薯条'] },
    { code: '2002', name: '大薯条', price: 14.5, tags: ['薯条'] },
    { code: '3001', name: '中杯可乐', price: 9.0, tags: ['饮料', '可乐'] },
    { code: '3002', name: '中杯无糖可乐', price: 9.0, tags: ['饮料', '可乐'] },
    { code: '3003', name: '中杯橙汁', price: 10.0, tags: ['饮料'] },
    { code: '4001', name: '麦辣鸡翅（2块）', price: 12.0, tags: ['小食', '辣'] },
    { code: '4002', name: '麦乐鸡（5块）', price: 12.0, tags: ['小食'] },
    { code: '5001', name: '巨无霸套餐（中）', price: 34.0, tags: ['套餐'] },
  ],
  foods: [
    { name: '巨无霸', calories: 514, price: 22.5 },
    { name: '双层吉士汉堡', calories: 451, price: 19.5 },
    { name: '麦辣鸡腿堡', calories: 500, price: 19.0 },
    { name: '中薯条', calories: 350, price: 12.5 },
    { name: '大薯条', calories: 460, price: 14.5 },
    { name: '中杯可乐', calories: 130, price: 9.0 },
    { name: '中杯无糖可乐', calories: 0, price: 9.0 },
    { name: '中杯橙汁', calories: 160, price: 10.0 },
    { name: '麦辣鸡翅（2块）', calories: 320, price: 12.0 },
    { name: '麦乐鸡（5块）', calories: 280, price: 12.0 },
  ],
};

/** 演示最优凑单：展示用券前后的价格 */
export function demoBestPlan() {
  const basket = demoData.meals.filter((m) => ['1001', '2001', '3001'].includes(m.code));
  const original = basket.reduce((s, m) => s + m.price, 0);
  return [
    { label: '无券', original, payable: original },
    { label: '满30减5', original, payable: original - 5 },
    { label: '免费中薯', original, payable: original - 12.5 },
  ];
}
