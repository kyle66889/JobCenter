# FBD SQL 查询 API 设计文档

- 日期：2026-06-26
- 分支：feat/rbac-user-role
- 状态：已通过设计评审，待写实现计划

## 1. 背景与目标

定时任务脚本（Python）需要查询生产数据库（SQL Server）做监控或为 FBD 中心 push 待审批任务。  
本功能在现有 `FbdPrdService` 基础上增加一个通用只读查询入口：

- 实现方法 `FbdPrdService.queryRaw(sql)` — 校验 + 查询
- 路由 `POST /api/fbd/query` — 供浏览器（JWT）和脚本（open API token）共用
- 脚本通过 `POST /open/fbd/query` 调用（app token + `fbd` scope），框架自动 rewrite 到 `/api/fbd/query`

**典型用途：** ① 阈值判断 → 邮件告警；② 查询结果整理后 push 一条 FBD 待审批任务。

**本期不包括：** 前端 UI 查询界面；结果分页；跨库查询；只读账号配置（见安全说明）。

## 2. 鉴权机制（重要）

本系统有两条鉴权路径（`back/loaders/express.ts`）：

| 调用方 | 路径 | Token 类型 | 校验逻辑 |
|--------|------|------------|---------|
| 浏览器（登录用户） | `POST /api/fbd/query` | JWT（登录会话） | `req.auth.userId` + RBAC `fbd` pageKey |
| 定时任务脚本 | `POST /open/fbd/query` | App token（不过期） | `express.ts:88-104`：token 对应的 app 需有 `fbd` scope；通过后 rewrite → `/api/fbd/query` |

**脚本不能用 JWT**：JWT 有过期时间，不适合 cron。  
**脚本使用 Open API token**：在「系统设置 → 应用管理」创建一个带 `fbd` scope 的 app，用其 token。

`/open/*` rewrite 逻辑（`express.ts:199`）：
```
/open/fbd/query
  → 鉴权：提取 key = "fbd"，验证 app token 有 fbd scope
  → rewrite → /api/fbd/query
  → 走同一个 POST handler
```

**结论：只需实现 `POST /api/fbd/query`，无需单独建 `/open/` 路由。**

## 3. 分层结构（对齐 fbdFuel.ts 模式）

```
back/shared/fbdQuery.ts        ← 纯逻辑：SQL 校验函数（可单测，无 DB 依赖）
back/shared/fbdQuery.test.ts   ← node:test 单测
back/services/fbdPrd.ts        ← 新增 queryRaw() 方法（复用已有 getDb()）
back/api/fbd.ts                ← 新增 POST /fbd/query 路由
```

## 4. SQL 校验（`back/shared/fbdQuery.ts`）

```typescript
export interface QueryValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateSqlQuery(sql: string): QueryValidationResult
```

校验顺序（遇第一个失败即返回）：

| # | 规则 | 检测 | 失败文案 |
|---|------|------|---------|
| 1 | 必须以 SELECT 开头 | `trim().toUpperCase()` 后 `/^SELECT\b/` | `'SQL 必须以 SELECT 开头'` |
| 2 | 禁止注释 | `/(--|\/\*)/.test(sql)` | `'不允许使用注释（-- 或 /* */）'` |
| 3 | 禁止分号（单条语句限制） | `/;/.test(sql)` | `'不允许使用分号（只允许单条语句）'` |
| 4 | 必须含 TOP | `/\bTOP\b/i` | `'缺少 TOP（如 SELECT TOP 100）'` |
| 5 | 必须含 NOLOCK | `/\bNOLOCK\b/i` | `'缺少 NOLOCK（如 WITH(NOLOCK)）'` |
| 6 | 禁止写操作关键字 | `/\b(UPDATE\|INSERT\|DELETE\|DROP\|TRUNCATE\|ALTER\|CREATE\|EXEC\|EXECUTE\|MERGE\|GRANT\|BACKUP)\b/i` | `'不允许写操作关键字'` |

**注意**：TOP / NOLOCK 是约定性 nudge，提醒调用方遵守规范；真正的安全防线是规则 1（SELECT 限制）、规则 2/3（防绕过）、规则 6（关键字黑名单）三层组合，以及服务端行数硬上限（见第 5 节）。

## 5. Service 层（`back/services/fbdPrd.ts`）

在现有 `FbdPrdService` 中新增方法：

```typescript
// 服务端最大返回行数（防 TOP 999999 打穿）
const QUERY_MAX_ROWS = 500;

public async queryRaw(sql: string): Promise<{ rows: any[]; count: number }> {
  const check = validateSqlQuery(sql);
  if (!check.ok) throw new Error(check.reason);
  const db = await this.getDb();
  const rows = (await db.query(sql, { type: QueryTypes.SELECT })) as any[];
  // 服务端硬截断，防 TOP 999999 返回过多行
  const capped = rows.slice(0, QUERY_MAX_ROWS);
  return { rows: capped, count: capped.length };
}
```

**安全说明（已知风险）：** `getDb()` 复用的连接账号（`FBDAppUser`）是可写的，`updateFuelSurcharge` 也用它执行 UPDATE。当前校验为软约束，无法从 DB 层面保证只读。理想做法是为查询配专用只读账号（`FBD_QUERY_DB_DSN_ENC`），但本期暂不引入第二套连接配置；生产使用前请评估风险。

## 6. API 路由（`back/api/fbd.ts`）

```
POST /api/fbd/query
```

**Joi body schema：**
```typescript
Joi.object({ sql: Joi.string().min(1).required() })
```

**Response — 成功：**
```json
{
  "code": 200,
  "data": { "rows": [{ "MZL_Priceid": 36, "FuelRate": 0.165 }], "count": 1 }
}
```

**Response — 校验/执行失败：**
```json
{ "code": 400, "message": "缺少 TOP（如 SELECT TOP 100）" }
```

> DB 错误原样返回 message，会泄露部分表结构信息。内部工具可接受，不对外暴露。

## 7. 单测（`back/shared/fbdQuery.test.ts`）

运行命令：
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts
```

覆盖用例：

| 用例 | 期望 |
|------|------|
| 合法 SQL（SELECT TOP 100 ... WITH(NOLOCK)） | `{ ok: true }` |
| 不以 SELECT 开头（如 UPDATE） | `{ ok: false, reason: 'SQL 必须以 SELECT 开头' }` |
| 含 `--` 注释 | `{ ok: false, reason: '不允许使用注释...' }` |
| 含 `/* */` 注释 | `{ ok: false, reason: '不允许使用注释...' }` |
| 含分号 | `{ ok: false, reason: '不允许使用分号...' }` |
| 缺少 TOP | `{ ok: false, reason: '缺少 TOP...' }` |
| 缺少 NOLOCK | `{ ok: false, reason: '缺少 NOLOCK...' }` |
| 含 UPDATE / DELETE / DROP / EXEC / MERGE（各一条） | `{ ok: false, reason: '不允许写操作关键字' }` |
| 空字符串 | `{ ok: false, reason: 'SQL 必须以 SELECT 开头' }` |
| 大小写混合（`select TOP 50 ... nolock`） | `{ ok: true }` |

## 8. 定时任务调用示例（Open API 路径）

```python
import os, json
from urllib.request import Request, urlopen

# 在「系统设置 → 应用管理」创建带 fbd scope 的 app，用其 token
QL_URL    = os.environ.get('QL_URL', 'http://localhost:5700')
FBD_TOKEN = os.environ.get('FBD_APP_TOKEN', '')  # Open API app token（不过期）

def fbd_query(sql: str) -> list[dict]:
    """调用 /open/fbd/query，框架自动 rewrite → /api/fbd/query"""
    req = Request(
        f'{QL_URL}/open/fbd/query',
        data=json.dumps({'sql': sql}).encode(),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {FBD_TOKEN}',
        },
        method='POST',
    )
    resp = json.loads(urlopen(req, timeout=30).read())
    if resp.get('code') != 200:
        raise RuntimeError(f"fbd_query failed: {resp.get('message')}")
    return resp['data']['rows']

# 示例：监控 FuelRate 异常
rows = fbd_query(
    "SELECT TOP 100 MZL_Priceid, FuelRate FROM MZL_Price WITH(NOLOCK) WHERE FuelRate > 0.3"
)
if rows:
    print(f"[告警] 发现 {len(rows)} 条 FuelRate > 0.3")
    # 调 notify / push FBD 任务
```

## 9. 改动文件清单

| 操作 | 文件 |
|------|------|
| 新增 | `back/shared/fbdQuery.ts` |
| 新增 | `back/shared/fbdQuery.test.ts` |
| 修改 | `back/services/fbdPrd.ts`（新增 `queryRaw` 方法） |
| 修改 | `back/api/fbd.ts`（新增 `POST /fbd/query` 路由） |

**无需改动：** `express.ts`、`pageKeys.ts`、前端代码（本期不加 UI）。
