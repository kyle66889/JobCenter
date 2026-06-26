# FBD SQL 查询 API 设计文档

- 日期：2026-06-26
- 分支：feat/rbac-user-role
- 状态：已通过设计评审，待写实现计划

## 1. 背景与目标

定时任务脚本（Python）需要查询生产数据库（SQL Server）做监控或为 FBD 中心 push 待审批任务。  
本功能在现有 `FbdPrdService` 基础上增加一个通用只读查询入口：

- `POST /api/fbd/query` — 接受一条 SQL SELECT，校验安全约束，返回查询结果
- 调用方：定时任务脚本，通过 Bearer token（fbd pageKey）调用
- 典型用途：① 阈值判断 → 邮件告警；② 查询结果整理后 push 一条 FBD 待审批任务

**本期不包括：** 前端 UI 查询界面；结果分页（TOP 已在 SQL 中约束行数）；跨库查询。

## 2. 分层结构（对齐 fbdFuel.ts 模式）

```
back/shared/fbdQuery.ts        ← 纯逻辑：SQL 校验函数（可单测，无 DB 依赖）
back/shared/fbdQuery.test.ts   ← node:test 单测
back/services/fbdPrd.ts        ← 新增 queryRaw() 方法（复用已有 getDb()）
back/api/fbd.ts                ← 新增 POST /fbd/query 路由
```

与 `back/shared/fbdFuel.ts` → `back/services/fbdPrd.ts#updateFuelSurcharge` → `back/api/fbd.ts` 完全对称。

## 3. SQL 校验（`back/shared/fbdQuery.ts`）

```typescript
export interface QueryValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateSqlQuery(sql: string): QueryValidationResult
```

校验顺序（按优先级，遇第一个失败即返回）：

| # | 规则 | 检测方式 | 失败原因文案 |
|---|------|----------|-------------|
| 1 | 必须以 SELECT 开头 | `trim().toUpperCase()` 后 `/^SELECT\b/` | `'SQL 必须以 SELECT 开头'` |
| 2 | 必须含 TOP | `/\bTOP\b/` | `'缺少 TOP（如 SELECT TOP 100）'` |
| 3 | 必须含 NOLOCK | `/\bNOLOCK\b/` | `'缺少 NOLOCK（如 WITH(NOLOCK)）'` |
| 4 | 禁止写操作关键字 | `/\b(UPDATE\|INSERT\|DELETE\|DROP\|TRUNCATE\|ALTER\|CREATE\|EXEC\|EXECUTE)\b/` | `'不允许写操作关键字'` |

校验通过返回 `{ ok: true }`；失败返回 `{ ok: false, reason: '...' }`。

## 4. Service 层（`back/services/fbdPrd.ts`）

在现有 `FbdPrdService` 中新增方法：

```typescript
public async queryRaw(sql: string): Promise<{ rows: any[]; count: number }> {
  const check = validateSqlQuery(sql);
  if (!check.ok) throw new Error(check.reason);
  const db = await this.getDb();
  const rows = await db.query(sql, { type: QueryTypes.SELECT });
  return { rows, count: rows.length };
}
```

- 先校验，再连接（避免无效连接）
- 复用 `getDb()` 懒连接单例，不新增连接开销
- 返回 `rows`（对象数组，列名为 key）+ `count`（行数）

## 5. API 路由（`back/api/fbd.ts`）

```
POST /api/fbd/query
```

**权限：** `fbd` pageKey（与列表/详情接口一致，自动通过 `PREFIX_MAP['/api/fbd']` 鉴权，无需额外配置）

**Request body（Joi 校验）：**
```json
{ "sql": "SELECT TOP 100 * FROM MZL_Price WITH(NOLOCK)" }
```

**Response — 成功：**
```json
{
  "code": 200,
  "data": {
    "rows": [{ "MZL_Priceid": 36, "FuelRate": 0.165, ... }, ...],
    "count": 1
  }
}
```

**Response — 校验失败：**
```json
{ "code": 400, "message": "缺少 TOP（如 SELECT TOP 100）" }
```

**Response — 执行失败（DB 报错）：**
```json
{ "code": 400, "message": "具体数据库错误信息" }
```

Joi body schema：
```typescript
Joi.object({ sql: Joi.string().min(1).required() })
```

## 6. 单测（`back/shared/fbdQuery.test.ts`）

使用 `node:test` + `node:assert`，运行命令：
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts
```

覆盖用例：

| 用例 | 期望 |
|------|------|
| 合法 SQL（含 SELECT/TOP/NOLOCK） | `{ ok: true }` |
| 不以 SELECT 开头 | `{ ok: false, reason: 'SQL 必须以 SELECT 开头' }` |
| 缺少 TOP | `{ ok: false, reason: '缺少 TOP...' }` |
| 缺少 NOLOCK | `{ ok: false, reason: '缺少 NOLOCK...' }` |
| 含 UPDATE | `{ ok: false, reason: '不允许写操作关键字' }` |
| 含 DELETE / DROP / EXEC（各一条） | 同上 |
| 空字符串 | `{ ok: false, reason: 'SQL 必须以 SELECT 开头' }` |
| 大小写混合（`select TOP 100 ... nolock`） | `{ ok: true }`（校验大小写不敏感） |

## 7. 定时任务调用示例

```python
import os, json
from urllib.request import Request, urlopen

QL_URL = os.environ.get('QL_URL', 'http://localhost:5700')
TOKEN  = os.environ.get('QL_TOKEN', '')   # fbd 角色的 Bearer token

def fbd_query(sql: str) -> list[dict]:
    req = Request(
        f'{QL_URL}/api/fbd/query',
        data=json.dumps({'sql': sql}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {TOKEN}'},
        method='POST',
    )
    resp = json.loads(urlopen(req, timeout=30).read())
    if resp.get('code') != 200:
        raise RuntimeError(f"fbd_query failed: {resp.get('message')}")
    return resp['data']['rows']

# 用法
rows = fbd_query("SELECT TOP 100 * FROM MZL_Price WITH(NOLOCK) WHERE FuelRate > 0.2")
print(f"共 {len(rows)} 行")
```

## 8. 改动文件清单

| 操作 | 文件 |
|------|------|
| 新增 | `back/shared/fbdQuery.ts` |
| 新增 | `back/shared/fbdQuery.test.ts` |
| 修改 | `back/services/fbdPrd.ts`（新增 `queryRaw` 方法） |
| 修改 | `back/api/fbd.ts`（新增 `POST /fbd/query` 路由） |
