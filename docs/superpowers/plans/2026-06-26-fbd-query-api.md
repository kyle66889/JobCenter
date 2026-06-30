# FBD SQL 查询 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `FbdPrdService` 上新增通用只读 SQL 查询方法，并通过 `POST /api/fbd/query` 对外暴露，脚本用 `POST /open/fbd/query`（open API token）调用，浏览器用 JWT 调用。

**Architecture:** 纯逻辑（SQL 校验）放 `back/shared/fbdQuery.ts`（可单测），执行放 `back/services/fbdPrd.ts#queryRaw()`（复用 `getDb()` 懒连接），路由加在现有 `back/api/fbd.ts`。与 `fbdFuel.ts` → `fbdPrd.ts#updateFuelSurcharge` → `back/api/fbd.ts` 完全对称。

**Tech Stack:** TypeScript + Express + Sequelize（mssql 方言）+ node:test + node:assert（单测）。

**设计文档：** `docs/superpowers/specs/2026-06-26-fbd-query-api-design.md`

**运行单测命令（本仓库约定）：**
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts
```

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `back/shared/fbdQuery.ts` | SQL 校验纯逻辑，无 DB 依赖 |
| 新增 | `back/shared/fbdQuery.test.ts` | 上述纯逻辑单测 |
| 修改 | `back/services/fbdPrd.ts` | 新增 `queryRaw()` 方法 |
| 修改 | `back/api/fbd.ts` | 新增 `POST /fbd/query` 路由 |

---

## Task 1: 纯逻辑 `back/shared/fbdQuery.ts` + 单测

**Files:**
- Create: `back/shared/fbdQuery.ts`
- Create: `back/shared/fbdQuery.test.ts`

- [ ] **Step 1: 先写失败的测试**

Create `back/shared/fbdQuery.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { validateSqlQuery } from './fbdQuery';

test('validateSqlQuery：合法 SQL 通过', () => {
  const r = validateSqlQuery(
    "SELECT TOP 100 * FROM MZL_Price WITH(NOLOCK)",
  );
  assert.deepStrictEqual(r, { ok: true });
});

test('validateSqlQuery：大小写混合通过', () => {
  const r = validateSqlQuery(
    "select top 50 col FROM dbo.Table WITH(nolock) where id > 1",
  );
  assert.deepStrictEqual(r, { ok: true });
});

test('validateSqlQuery：空字符串 → SELECT 开头', () => {
  const r = validateSqlQuery('');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /SELECT 开头/);
});

test('validateSqlQuery：不以 SELECT 开头', () => {
  const r = validateSqlQuery('UPDATE MZL_Price SET FuelRate=0.1');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /SELECT 开头/);
});

test('validateSqlQuery：含 -- 注释 → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) -- comment",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /注释/);
});

test('validateSqlQuery：含 /* */ 注释 → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 /* comment */ * FROM T WITH(NOLOCK)",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /注释/);
});

test('validateSqlQuery：含分号 → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK); SELECT 1",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /分号/);
});

test('validateSqlQuery：缺 TOP → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT * FROM MZL_Price WITH(NOLOCK)",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /TOP/);
});

test('validateSqlQuery：缺 NOLOCK → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 100 * FROM MZL_Price",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /NOLOCK/);
});

test('validateSqlQuery：含 UPDATE → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 1 * FROM T WITH(NOLOCK) WHERE UPDATE=1",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 DELETE → 拒绝', () => {
  const r = validateSqlQuery("DELETE FROM T");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /SELECT 开头/);
});

test('validateSqlQuery：含 DROP → 拒绝（作为词边界）', () => {
  // 以 SELECT 开头但 SQL 里含 DROP 关键字
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) WHERE DROP=1",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 EXEC → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) EXEC sp_help",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 MERGE → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) MERGE INTO T",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});
```

- [ ] **Step 2: 运行测试，确认失败（模块不存在）**

```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts
```

Expected: FAIL — `Cannot find module './fbdQuery'`

- [ ] **Step 3: 实现 `back/shared/fbdQuery.ts`**

```typescript
export interface QueryValidationResult {
  ok: boolean;
  reason?: string;
}

// 校验顺序：SELECT 开头 → 禁注释 → 禁分号 → 必须 TOP → 必须 NOLOCK → 禁写关键字
export function validateSqlQuery(sql: string): QueryValidationResult {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  if (!/^SELECT\b/.test(upper)) {
    return { ok: false, reason: 'SQL 必须以 SELECT 开头' };
  }
  if (/--|\/\*/.test(trimmed)) {
    return { ok: false, reason: '不允许使用注释（-- 或 /* */）' };
  }
  if (/;/.test(trimmed)) {
    return { ok: false, reason: '不允许使用分号（只允许单条语句）' };
  }
  if (!/\bTOP\b/.test(upper)) {
    return { ok: false, reason: '缺少 TOP（如 SELECT TOP 100）' };
  }
  if (!/\bNOLOCK\b/.test(upper)) {
    return { ok: false, reason: '缺少 NOLOCK（如 WITH(NOLOCK)）' };
  }
  if (/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|MERGE|GRANT|BACKUP)\b/.test(upper)) {
    return { ok: false, reason: '不允许写操作关键字' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts
```

Expected: 全部 `✔` 通过，0 failures

- [ ] **Step 5: Commit**

```bash
git add back/shared/fbdQuery.ts back/shared/fbdQuery.test.ts
git commit -m "feat(fbd): SQL 查询校验纯逻辑 validateSqlQuery + 单测"
```

---

## Task 2: `FbdPrdService.queryRaw()` 方法

**Files:**
- Modify: `back/services/fbdPrd.ts`

当前文件结构：`getConf()` → `loadTedious()` → `FbdPrdService`（含 `getDb()`、`apply()`、`updateFuelSurcharge()`）。

在文件顶部 import 区加入 `validateSqlQuery`，在类末尾新增 `queryRaw` 方法。

- [ ] **Step 1: 在 `back/services/fbdPrd.ts` 顶部添加 import**

在现有 import 区（第 1-8 行）末尾加一行：

```typescript
import { validateSqlQuery } from '../shared/fbdQuery';
```

完整 import 区变为：

```typescript
import fs from 'fs';
import path from 'path';
import { QueryTypes, Sequelize } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import config from '../config';
import { decrypt } from '../shared/fbdCrypto';
import { buildFuelUpdates } from '../shared/fbdFuel';
import { validateSqlQuery } from '../shared/fbdQuery';
```

- [ ] **Step 2: 在类末尾（`updateFuelSurcharge` 之后、`}` 之前）添加 `queryRaw` 方法**

在 `back/services/fbdPrd.ts` 末尾的 `}` 前插入：

```typescript
  // 服务端最大返回行数（防 TOP 999999 打穿）
  private static readonly QUERY_MAX_ROWS = 500;

  public async queryRaw(sql: string): Promise<{ rows: any[]; count: number }> {
    const check = validateSqlQuery(sql);
    if (!check.ok) throw new Error(check.reason);
    const db = await this.getDb();
    const rows = (await db.query(sql, { type: QueryTypes.SELECT })) as any[];
    const capped = rows.slice(0, FbdPrdService.QUERY_MAX_ROWS);
    this.logger.info('[fbdPrd] query rows=%d sql=%s', capped.length, sql.slice(0, 120));
    return { rows: capped, count: capped.length };
  }
```

- [ ] **Step 3: 确认 TypeScript 编译无错**

```bash
npx tsc -p back/tsconfig.json --noEmit
```

Expected: 无输出（零错误）

- [ ] **Step 4: Commit**

```bash
git add back/services/fbdPrd.ts
git commit -m "feat(fbd): FbdPrdService.queryRaw() — 通用只读 SQL 查询"
```

---

## Task 3: 路由 `POST /api/fbd/query`

**Files:**
- Modify: `back/api/fbd.ts`

在现有 `DELETE /tasks` handler 之后、文件末尾的 `};` 之前新增路由。

- [ ] **Step 1: 在 `back/api/fbd.ts` 顶部确认 import 已含 `FbdPrdService`**

当前 import 区：

```typescript
import { Joi, celebrate } from 'celebrate';
import { NextFunction, Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import FbdService from '../services/fbd';
import RbacService from '../services/rbac';
```

新增一行 import `FbdPrdService`：

```typescript
import { Joi, celebrate } from 'celebrate';
import { NextFunction, Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import FbdService from '../services/fbd';
import FbdPrdService from '../services/fbdPrd';
import RbacService from '../services/rbac';
```

- [ ] **Step 2: 在 `DELETE /tasks` handler 末尾（`};` 行前）插入新路由**

在文件最后 `};` 之前插入：

```typescript
  route.post(
    '/query',
    celebrate({
      body: Joi.object({ sql: Joi.string().min(1).required() }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdPrdService = Container.get(FbdPrdService);
        const data = await fbdPrdService.queryRaw(req.body.sql);
        return res.send({ code: 200, data });
      } catch (e: any) {
        return res.send({ code: 400, message: e?.message || String(e) });
      }
    },
  );
```

- [ ] **Step 3: 确认 TypeScript 编译无错**

```bash
npx tsc -p back/tsconfig.json --noEmit
```

Expected: 无输出（零错误）

- [ ] **Step 4: Commit**

```bash
git add back/api/fbd.ts
git commit -m "feat(fbd): POST /api/fbd/query — 通用只读 SQL 查询路由"
```

---

## Task 4: 冒烟测试（集成验证）

不需要修改任何文件，只跑命令验证整条链路。

- [ ] **Step 1: 重建镜像并启动容器**

```bash
cd docker
docker compose build > build.log 2>&1; echo "exit=$?"
docker compose up -d --force-recreate
```

Expected: `exit=0`，`docker ps` 显示 `(healthy)`

- [ ] **Step 2: 等容器 healthy，用 open API token 测试校验失败路径**

```bash
docker exec docker-web-1 python3 - <<'PY'
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# 读 config.sh 里的 open API token（或直接用管理员 token 测 /api/ 路径）
import sqlite3, json as j
c = sqlite3.connect('/ql/data/db/database.sqlite')
info = j.loads(c.execute("SELECT info FROM Auths WHERE id=3").fetchone()[0])
token = info['token']

base = 'http://127.0.0.1:5700'

# 1. 缺 TOP → 应 400
req = Request(f'{base}/api/fbd/query',
    data=j.dumps({'sql': 'SELECT * FROM MZL_Price WITH(NOLOCK)'}).encode(),
    headers={'Content-Type':'application/json','Authorization':f'Bearer {token}'},
    method='POST')
r = j.loads(urlopen(req, timeout=10).read())
print('缺TOP:', r['code'], r.get('message'))

# 2. 含分号 → 应 400
req = Request(f'{base}/api/fbd/query',
    data=j.dumps({'sql': 'SELECT TOP 10 * FROM MZL_Price WITH(NOLOCK); SELECT 1'}).encode(),
    headers={'Content-Type':'application/json','Authorization':f'Bearer {token}'},
    method='POST')
r = j.loads(urlopen(req, timeout=10).read())
print('含分号:', r['code'], r.get('message'))

# 3. 合法 SQL → 应 200
req = Request(f'{base}/api/fbd/query',
    data=j.dumps({'sql': 'SELECT TOP 5 * FROM FbdTasks WITH(NOLOCK)'}).encode(),
    headers={'Content-Type':'application/json','Authorization':f'Bearer {token}'},
    method='POST')
r = j.loads(urlopen(req, timeout=10).read())
print('合法SQL:', r['code'], 'rows=', r.get('data',{}).get('count'))
PY
```

Expected 输出：
```
缺TOP: 400 缺少 TOP（如 SELECT TOP 100）
含分号: 400 不允许使用分号（只允许单条语句）
合法SQL: 200 rows= <N>
```

- [ ] **Step 3: Commit（如有临时调试改动）**

若无代码改动则跳过此步。
