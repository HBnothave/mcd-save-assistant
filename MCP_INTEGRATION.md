# 麦当劳 MCP 集成说明（MCP_INTEGRATION.md）

本文档说明「麦门省钱助手」实际使用的麦当劳 MCP Server、所调用的 Tool、调用流程与业务价值。

---

## 1. 使用的麦当劳 MCP Server

| 项 | 内容 |
|---|---|
| MCP Server | 麦当劳中国官方 MCP Server |
| 接入地址 | `https://mcp.mcd.cn` |
| 协议 | Streamable HTTP（MCP，JSON-RPC 2.0） |
| 鉴权 | HTTP Header：`Authorization: Bearer <MCP_TOKEN>` |
| Token 申请 | 登录 [https://open.mcd.cn/mcp](https://open.mcd.cn/mcp) → 控制台 → 激活 |

> 本项目 **直接以 MCP Client 身份** 与官方 Server 通信（见 `src/mcp-client.js`），
> 完成标准 MCP 握手（`initialize` / `notifications/initialized` / `tools/list` / `tools/call`），
> 所有餐品、价格、券、积分数据均来自麦当劳官方实时接口，非本地伪造。

---

## 2. 实际调用的餐饮 MCP Tools

| 功能模块 | 调用的 Tool | 用途 |
|---|---|---|
| 麦麦省领券 | `available-coupons` | 查询当前可领取的麦麦省优惠券列表 |
| 麦麦省领券 | `auto-bind-coupons` | 一键自动领取所有可领的优惠券 |
| 我的券 | `query-my-coupons` | 查看账户下所有可用优惠券 |
| 最优凑单 | `query-nearby-stores` | 查询附近可用门店（定位点餐门店） |
| 最优凑单 | `query-meals` | 查询门店在售餐品（分类、编码、标签） |
| 最优凑单 | `query-store-coupons` | 查询当前门店可用优惠券 |
| 最优凑单 | `calculate-price` | 按商品列表（可含优惠券）计算金额、优惠与应付总价 |
| 营养搭配 | `list-nutrition-foods` | 获取餐品营养成分（能量、蛋白质、脂肪、钠等） |
| 活动日历 | `campaign-calendar` | 查询麦当劳中国当月营销活动日历 |
| 积分看板 | `query-my-account` | 查询账户可用/累计/即将过期积分 |
| 积分商城 | `mall-points-products` | 查询麦麦商城可积分兑换的商品 |

---

## 3. 典型调用流程

### 流程 A：麦麦省一键领券

```
用户输入: mcd-save coupons
   │
   ├─▶ available-coupons        查询可领券列表
   ├─▶ auto-bind-coupons        一键领取全部可用券
   └─▶ query-my-coupons         展示我的券（名称/金额/到期时间）
```

### 流程 B：最优凑单省钱（核心）

```
用户输入: mcd-save save "巨无霸 薯条 可乐"
   │
   ├─▶ query-nearby-stores                  定位附近可用门店
   ├─▶ query-meals                          拉取该门店在售餐品（128 款）
   ├─▶ （内置引擎）buildBasket              把"巨无霸 薯条 可乐"模糊匹配为购物篮
   ├─▶ calculate-price(无券)                试算原价
   ├─▶ query-store-coupons + calculate-price 试算"门店券"方案
   └─▶ query-my-coupons + calculate-price   试算"我的券"方案
        └─▶ comparePlan 选出应付最低的方案，并输出省了多少钱
```

### 流程 C：营养搭配

```
用户输入: mcd-save nutrition --kcal 600
   │
   ├─▶ list-nutrition-foods    获取营养成分数据
   └─▶ （内置引擎）planNutrition  在 600 kcal 预算内做贪心组合推荐
```

---

## 4. 业务价值

1. **省钱看得见**：不满足于“能给券”，而是把一个订单在【无券 / 门店券 / 我的券】三套方案下
   真实试算价格，给出**应付金额最低**的推荐，并明确展示「已优惠 -¥xx.xx」。
2. **降低使用门槛**：麦当劳 App 找券、凑单、比价需要多次翻页；本 Skill 一句话完成：
   `mcd-save save "巨无霸 薯条 可乐"`，几秒出结果。
3. **健康透明**：利用官方营养数据做热量预算搭配，让常吃快餐的人也能吃得明白。
4. **权益不漏**：一键领券 + 积分看板，避免"券忘了领、积分过期"的损失。
5. **实时可信**：所有数据来自麦当劳 MCP 实时接口，与官方渠道一致。

---

## 5. 涉及字段与频控说明

- 麦当劳 MCP 限流：每 Token 每分钟最多 **600** 次请求（超出返回 429），
  本项目在 `mcp-client.js` 中对 401/429/其他异常均做明确提示。
- 信息安全：真实 Token 只存在于本地 `.env`（已被 `.gitignore` 排除），
  仓库内配置示例 `mcp-config.example.json` 仅含环境变量占位符 `${MCD_MCP_TOKEN}`。
