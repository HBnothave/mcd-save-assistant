<div align="center">

# 🍔 麦门省钱助手（MCD Save Assistant）

**基于麦当劳 MCP 的智能点餐省钱 Skill —— 一键领券、最优凑单、营养搭配、活动日历、积分兑换**

[![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=nodedotjs)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-blueviolet)](https://github.com/M-China/mcd-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-13%2F13%20passing-brightgreen)](#-开发与测试)

**“打工人也想吃好麦当劳，更想花得聪明。”**

</div>

---

## ✨ 项目介绍

麦门省钱助手是一个基于 **麦当劳 MCP（Model Context Protocol）** 开发的命令行 Skill。
它不只是一个点餐工具，而是一套 **“更聪明的点餐决策系统”**：

- 💰 **麦麦省一键领券**：自动领取当前所有可用的麦当劳优惠券，不用再翻 App 找券
- 🧮 **最优凑单省钱**：把你“想吃的东西”翻译成购物篮，自动试算【无券 / 门店券 / 我的券】三套价格，告诉你最省的付法
- 🥗 **营养搭配**：给定热量预算（如 600 kcal），从营养库推荐组合，减脂期也能放心吃
- 🎉 **活动日历**：一眼看清本月进行中的麦当劳营销活动
- ⭐ **积分看板**：可用积分、积分商城，别让积分过期
- 🏪 **附近门店**：查附近可服务的麦当劳门店

> 本项目使用麦当劳官方 MCP Server（`https://mcp.mcd.cn`），所有餐品、价格、券、积分均为**实时真实数据**。
> 本项目为参赛作品，非麦当劳官方产品，输出仅供参考。

---

## 🚀 快速开始

### 前置条件

- Node.js **18+**（本仓库零依赖，无需 `npm install`）
- 一个**麦当劳中国 MCP Token**（下方申请）

### 第 1 步：申请 MCP Token

1. 打开 👉 **https://open.mcd.cn/mcp**
2. 点击右上角 **【登录】**，使用手机号验证登录
3. 登录后右上角变为 **【控制台】**，点击 → **【激活】** 申请 MCP Token
4. 阅读并同意服务协议，成功后可 **一键复制** Token

### 第 2 步：配置 Token

```bash
# 复制示例配置
cp .env.example .env

# 编辑 .env，把 YOUR_MCP_TOKEN_HERE 换成真实 Token
```

### 第 3 步：跑起来

```bash
# 检查连接是否成功
node src/index.js status

# 一键领券 + 查看我的优惠券
node src/index.js coupons

# 核心功能：想吃巨无霸 + 薯条 + 可乐，自动算出最省方案
node src/index.js save "巨无霸 薯条 可乐"

# 营养搭配：600 kcal 预算怎么吃
node src/index.js nutrition --kcal 600

# 本月活动日历
node src/index.js campaign

# 我的积分 / 积分商城
node src/index.js points
```

### 不想申请 Token？先试试演示模式 🧪

```bash
node src/index.js demo
```

演示模式用内置示例数据展示省钱算法，无需任何 Token。

---

## 📖 使用示例

### 真实输出（真实 MCP 联调实测）

```text
🎯 想吃：巨无霸 / 薯条 / 可乐
📍 正在查询附近门店…
   已选门店: 麦当劳上海黄浦悦荟广场餐厅 (1450104)

🍟 正在拉取门店菜单…
   在售餐品 116 款

💸 正在计算价格与优惠…
✅ 最优方案：
   • 巨无霸 ×1
   • 薯条 ×1
   • 可乐 ×1
   应付：   ¥48.50（方案：无券）
   原价：   ¥48.50
   已优惠： -¥0.00

📋 全部试算：
   无券           ¥48.50
```

### 一键领券（真实领到 3 张券）

```text
📢 麦麦省一键领券：
   总计: 3 张优惠券
   成功: 3 张

   - 11.9元麦辣鸡腿堡
   - 19.9元王牌炸鸡任选2
   - 免费脆薯饼

🎫 我的优惠券：
   共 2 张可用优惠券
```

### 营养搭配

```text
🥗 营养搭配（热量预算 600 kcal）：
   • 冰燕麦奶中杯 ×3  597 kcal
   • 锡兰红茶 ×1  2 kcal
   合计：599 kcal
```

---

## ⚙️ 实现原理

```
┌────────────┐    Streamable HTTP    ┌──────────────────┐
│  麦门省钱助手 │ ───────────────────▶ │  麦当劳 MCP Server │
│  (MCP Client) │  Authorization: Bearer │  https://mcp.mcd.cn │
└────────────┘  ◀─────────────────── └──────────────────┘
       │
       ├─ 麦麦省一键领券：available-coupons → auto-bind-coupons → query-my-coupons
       ├─ 最优凑单：     query-nearby-stores → query-meals → calculate-price（多方案对比）
       ├─ 营养搭配：     list-nutrition-foods（热量预算贪心算法）
       ├─ 活动日历：     campaign-calendar
       └─ 积分商城：     query-my-account / mall-points-products
```

技术要点：

- 自研 **最小化 Streamable HTTP MCP 客户端**（`src/mcp-client.js`），符合 MCP 协议 2025-03-26，**零第三方依赖**
- 完整的 `initialize` 握手、Session 管理、`tools/list`、`tools/call`，兼容 JSON 与 SSE 响应
- 内置 **模糊餐品匹配、购物篮去重、价格字段兼容解析、热量预算贪心算法**（`src/engine.js`）
- 纯逻辑层与展示层分离，附 **19 个单元测试**，`npm test` 一键跑通

---

## 🎯 目标用户

| 用户 | 痛点 | 麦门省钱助手 |
|---|---|---|
| 打工人 / 学生党 | 天天吃麦当劳想省钱 | 一键领券 + 最优凑单，自动算最省价 |
| 减肥健身人群 | 想吃又怕热量超 | 600 kcal 营养搭配，明明白白 |
| 薅羊毛爱好者 | 券太多不会用、总忘领 | 自动领券，活动日历一眼看全 |
| 麦当劳会员 | 积分过期浪费 | 积分看板 + 积分商城 |

---

## 🔌 接入其他 MCP 客户端

除了命令行，本项目同样提供了标准 MCP 客户端配置（见 [`mcp-config.example.json`](./mcp-config.example.json)），
可直接用于 **WorkBuddy / Cherry Studio / Cursor / Trae / VSCode** 等任意支持 Streamable HTTP 的客户端。

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

> ⚠️ 记得把 `${MCD_MCP_TOKEN}` 替换成你的真实 Token（配置文件仅保留环境变量占位符）。

---

## 🧑‍💻 开发与测试

```bash
# 运行全部单元测试（19 个，纯逻辑，无需 Token）
npm test
# 等价于：
node --test "test/*.test.js"

# 手动演示
node src/index.js demo
```

```
✔ matchMeals 精确名称命中 ✔ buildBasket 构造购物篮 ✔ parsePriceResult 字段兼容
✔ comparePlan 金额小的优先 ✔ filterValidPlans 过滤无效 ✔ planNutrition 热量预算
✔ extractJson 代码块/前后缀兼容 …… （19/19 passing）
```

---

## 📁 目录结构

```
mcd-save-assistant/
├── src/
│   ├── index.js          # CLI 入口（status/tools/coupons/save/nutrition/campaign/points/stores/demo）
│   ├── mcp-client.js     # 最小化 Streamable HTTP MCP 客户端（零依赖）
│   ├── tools.js          # 麦当劳 MCP 工具封装 + JSON 兼容解析
│   ├── engine.js         # 省钱/营养/匹配引擎（纯逻辑）
│   └── demo-data.js      # 演示数据（仅 demo/测试使用）
├── test/
│   └── engine.test.js    # 19 个单元测试
├── README.md             # 本文件
├── CONTEST_DECLARATION.md # 参赛声明（官方原文，不可修改）
├── MCP_INTEGRATION.md    # MCP 集成说明
├── mcp-config.example.json
├── workbuddy.md          # WorkBuddy 上下文
├── .env.example          # 环境变量示例（Token 占位）
└── package.json          # 零依赖
```

---

## 📜 免责声明

- 本项目为 **麦当劳程序员节创意开发大赛参赛作品**，非麦当劳官方产品
- 所有餐品、价格、优惠、库存信息以麦当劳官方渠道**实时结果为准**
- 输出仅供参考，不构成医疗、营养或其他专业建议
- 请妥善保管 MCP Token，**切勿提交到公开仓库**

---

<p align="center">
  <sub>Made with ❤️ for 麦当劳程序员节 · 1024 Programmer's Day</sub>
</p>
