# WorkBuddy 对话上下文（workbuddy.md）

本文档记录「麦门省钱助手」配合腾讯 WorkBuddy 使用时的连接器配置与对话上下文，
用于麦当劳程序员节创意开发大赛 WorkBuddy 联动活动核验。

---

## 1. 连接器配置（MCP）

在 WorkBuddy 左侧边栏【专家·技能·连接器】→【连接器】页签 →【自定义连接器】→【配置 MCP】，
填入以下 JSON（将 `${MCD_MCP_TOKEN}` 替换为真实 Token 后保存并启用）：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer ${MCD_MCP_TOKEN}"
      }
    }
  }
}
```

> 参考：WorkBuddy 官方文档「自定义连接器 / 配置MCP」章节。

## 2. 在 WorkBuddy 中的对话上下文

启动 mcd-mcp 连接器后，可在对话框输入以下提示词让 AI 调用麦当劳 MCP：

```text
你是一个「麦门省钱助手」。基于麦当劳 MCP 的能力，帮助我做以下事情：
1. 帮我领取当前所有可用的麦当劳优惠券（可用工具：available-coupons / auto-bind-coupons）
2. 展示我账户里可用的优惠券（工具：query-my-coupons）
3. 我想吃【巨无霸、薯条、可乐】，请帮我找到附近门店，用最优惠的方式计算出应付金额
   （工具：query-nearby-stores → query-meals → query-store-coupons / query-my-coupons → calculate-price）
4. 帮我做一份 600 千卡之内的营养搭配（工具：list-nutrition-foods）
5. 告诉我这个月麦当劳有什么活动（工具：campaign-calendar）
6. 查一下我的积分和积分商城有什么可换（工具：query-my-account / mall-points-products）
```

### 推荐对话示例

**用户**：帮我看看这个月麦当劳有什么活动，顺便帮我把能领的券都领了。

**AI（调用 MCP）**：

1. `available-coupons` → 查询到可领券列表
2. `auto-bind-coupons` → 自动领取全部可用券
3. `campaign-calendar` → 返回本月活动日历
4. 汇总输出：已领取 N 张券 + 本月活动摘要

**用户**：我想吃巨无霸套餐，帮我看看附近哪家店最合适、怎么买最便宜。

**AI（调用 MCP）**：

1. `query-nearby-stores` → 定位附近门店
2. `query-meals` → 获取在售餐品
3. `calculate-price`（含/不含券两次试算）→ 对比价格
4. 汇总输出：推荐门店 + 最优方案 + 优惠金额

## 3. 说明

- 本项目同样提供**独立 CLI**（`node src/index.js <command>`），不依赖 WorkBuddy 亦可运行；
- 上述 MCP 调用与命令行功能一致，均为**真实调用麦当劳 MCP Server**；
- 配置文件中不含任何真实 Token，均为环境变量占位符。
