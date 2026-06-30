# FBD Surcharge 周检定时任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每周一 8 点查生产库新增 FedEx surcharge 项，有数据则在 FBD 中心生成待审批任务（type `Surcharge`）并发邮件；审批仅确认不写 prd。

**Architecture:** 把 prd 连接构建从 `FbdPrdService` 抽到 `fbdPrdConn.ts`，供 service 和一个新的容器内 Node CLI 共用；Python 定时脚本调 CLI 执行查询（复用 `validateSqlQuery`），有结果则直连 sqlite 写 FBD 任务 + 发邮件。

**Tech Stack:** TypeScript + Sequelize(mssql/tedious) + typedi（后端）；Node CLI；Python 标准库（cron 脚本）；node:test。

**设计文档：** `docs/superpowers/specs/2026-06-26-fbd-surcharge-check-cron-design.md`

**运行单测：** `TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test <文件>`
**编译后端：** `npm run build:back`

---

## 文件结构
- 新增 `back/services/fbdPrdConn.ts` — prd 连接构建（config.sh 解析 + 解密 + tedious + sequelize），无 typedi
- 改 `back/services/fbdPrd.ts` — 用 `createPrdSequelize`；`apply` 加 `Surcharge` 分支；删内联 helper
- 新增 `back/scripts/fbd-query.ts` — 容器内查询 CLI（复用 validateSqlQuery + createPrdSequelize）
- 改 `back/shared/fbdQuery.test.ts` — 补真实 SQL 通过校验的断言
- 新增 `docker/data/scripts/fbd_surcharge_check.py` — 周检脚本
- Crontab 行入库（部署步骤）

---

## Task 1: 抽出 fbdPrdConn.ts + fbdPrd 改用 + 加 Surcharge 分支

**Files:**
- Create: `back/services/fbdPrdConn.ts`
- Modify: `back/services/fbdPrd.ts`

- [ ] **Step 1: 创建 `back/services/fbdPrdConn.ts`**
```ts
import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import config from '../config';
import { decrypt } from '../shared/fbdCrypto';

// tedious：本地开发正常 require；运行镜像装在 /ql/fbd_modules/node_modules
export function loadTedious(): any {
  try {
    return require('tedious');
  } catch (_) {
    return require('/ql/fbd_modules/node_modules/tedious');
  }
}

// 后端进程不加载 config.sh（仅 shell 任务执行时 source），故按行解析 config.sh
function readConfigShVar(name: string): string | undefined {
  try {
    const file = path.join(config.configPath, 'config.sh');
    const content = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.+?)\\s*$`);
    let raw: string | undefined;
    for (const line of content.split(/\r?\n/)) {
      const m = re.exec(line);
      if (m) raw = m[1];
    }
    if (raw === undefined) return undefined;
    const val = raw.trim();
    if (val[0] === '"' || val[0] === "'") {
      const end = val.indexOf(val[0], 1);
      return end > 0 ? val.slice(1, end) : val.slice(1);
    }
    const h = val.search(/\s#/);
    return (h >= 0 ? val.slice(0, h) : val).trim();
  } catch (_) {
    return undefined;
  }
}

export function getConf(name: string): string | undefined {
  return process.env[name] || readConfigShVar(name);
}

// 构建（未缓存）prd Sequelize 实例；调用方负责 authenticate / close / 缓存
export function createPrdSequelize(): Sequelize {
  const enc = getConf('FBD_PRD_DB_DSN_ENC');
  const key = getConf('FBD_SECRET_KEY');
  if (!enc || !key) {
    throw new Error('缺少 FBD_PRD_DB_DSN_ENC 或 FBD_SECRET_KEY');
  }
  const conf = JSON.parse(decrypt(enc, key));
  return new Sequelize({
    dialect: 'mssql',
    dialectModule: loadTedious(),
    host: conf.host,
    port: conf.port || 1433,
    database: conf.database,
    username: conf.username,
    password: conf.password,
    logging: false,
    dialectOptions: {
      options: {
        encrypt: conf.encrypt !== false,
        trustServerCertificate: conf.trustServerCertificate !== false,
      },
    },
  });
}
```

- [ ] **Step 2: 改 `back/services/fbdPrd.ts`**

把文件**开头到 `getDb` 之间**的内联 helper（`readConfigShVar`/`getConf`/`loadTedious`）删除，并调整 import。具体：

将顶部 import 段（第 1–9 行）替换为：
```ts
import { QueryTypes, Sequelize } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { buildFuelUpdates } from '../shared/fbdFuel';
import { validateSqlQuery } from '../shared/fbdQuery';
import { createPrdSequelize } from './fbdPrdConn';
```

删除第 11–51 行（三个内联函数 `readConfigShVar` / `getConf` / `loadTedious` 及其注释）。

将 `getDb` 方法体替换为（用 createPrdSequelize）：
```ts
  private async getDb(): Promise<Sequelize> {
    if (this.db) return this.db;
    let db: Sequelize | undefined;
    try {
      db = createPrdSequelize();
      await db.authenticate();
      this.db = db;
      return db;
    } catch (e) {
      if (db) await db.close().catch(() => {});
      throw e;
    }
  }
```

在 `apply` 的 switch 里，`case 'fedex_fuel_charge'` 之后、`default` 之前，加：
```ts
      case 'Surcharge':
        return '已确认（Surcharge 类型暂无自动处理）';
```

- [ ] **Step 3: 编译，确认零错误**

Run: `npm run build:back`
Expected: 编译成功，零 TS 错误。

- [ ] **Step 4: 提交**
```bash
git add back/services/fbdPrdConn.ts back/services/fbdPrd.ts
git commit -m "refactor(fbd): 抽出 fbdPrdConn.createPrdSequelize + apply 加 Surcharge 分支

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 查询 CLI `back/scripts/fbd-query.ts`

**Files:**
- Create: `back/scripts/fbd-query.ts`

- [ ] **Step 1: 创建文件**
```ts
import { QueryTypes } from 'sequelize';
import { validateSqlQuery } from '../shared/fbdQuery';
import { createPrdSequelize } from '../services/fbdPrdConn';

(async () => {
  const sql = process.argv[2];
  if (!sql) {
    console.error('用法: node fbd-query.js "<SQL>"');
    process.exit(1);
  }
  const v = validateSqlQuery(sql);
  if (!v.ok) {
    console.error('SQL 校验失败: ' + v.reason);
    process.exit(1);
  }
  const db = createPrdSequelize();
  try {
    const rows = await db.query(sql, { type: QueryTypes.SELECT });
    process.stdout.write(JSON.stringify({ rows, count: rows.length }));
    await db.close();
    process.exit(0);
  } catch (e: any) {
    console.error('查询失败: ' + (e?.message || String(e)));
    try {
      await db.close();
    } catch (_) {}
    process.exit(1);
  }
})();
```

- [ ] **Step 2: 编译并确认产物存在**

Run: `npm run build:back && ls static/build/scripts/fbd-query.js`
Expected: 编译成功，且列出 `static/build/scripts/fbd-query.js`（运行镜像里对应 `/ql/static/build/scripts/fbd-query.js`）。

- [ ] **Step 3: 提交**
```bash
git add back/scripts/fbd-query.ts
git commit -m "feat(fbd): 容器内查询 CLI fbd-query（复用校验+prd 连接）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 真实 SQL 通过校验的回归断言

**Files:**
- Modify: `back/shared/fbdQuery.test.ts`

- [ ] **Step 1: 追加测试**

在 `back/shared/fbdQuery.test.ts` 末尾追加（导入已有 `validateSqlQuery`，无需改 import）：
```ts
test('surcharge 周检的真实 SQL（去注释/分号后）通过校验', () => {
  const sql =
    "SELECT TOP 100 s.ServiceType, s.Name AS APIFeeName, s.Explain AS SampleExplain, " +
    "DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) AS CreateTime " +
    "FROM ShippingFeeOtherItem s WITH (NOLOCK) " +
    "CROSS APPLY (SELECT (s.Id / 4194304) + 1288834974657 AS ms) c " +
    "WHERE NOT EXISTS (SELECT 1 FROM MZL_FinanceCustomerBillItem i WITH (NOLOCK) WHERE i.Name = s.Name) " +
    "AND s.ServiceType = 'FedEx' AND s.Name not in ('基础运费','netFreight') " +
    "AND DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) > '2025-10-01' " +
    "ORDER BY s.ServiceType, s.Name";
  assert.strictEqual(validateSqlQuery(sql).ok, true);
});
```

- [ ] **Step 2: 运行测试，确认全过**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts
```
Expected: 全部 PASS（含新加这条）。
（若新断言失败，说明真实 SQL 撞了某条校验——需回看 SQL，不要放松校验。）

- [ ] **Step 3: 提交**
```bash
git add back/shared/fbdQuery.test.ts
git commit -m "test(fbd): 周检真实 SQL 通过 validateSqlQuery 回归断言

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 周检脚本 `docker/data/scripts/fbd_surcharge_check.py`

**Files:**
- Create: `docker/data/scripts/fbd_surcharge_check.py`

- [ ] **Step 1: 创建脚本（完整内容）**
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FedEx Surcharge 检查
new Env('FedEx Surcharge 检查')
cron: 0 8 * * 1

每周一 8 点查生产库新增 FedEx surcharge 项；有数据则在 FBD 中心生成待审批任务并发邮件。
通过容器内 Node CLI 调用查询（复用后端校验 + prd 连接），零额外依赖。
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

DB_FILE = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "db", "database.sqlite")
)
CLI = "/ql/static/build/scripts/fbd-query.js"
FBD_TYPE = "Surcharge"
FBD_SOURCE = "FedEx Surcharge 检查"
TASK_NAME = "FedEx Surcharge 检查"

# 注意：去掉了原 SQL 末尾的 `-- 注释` 和分号，否则过不了查询校验
SQL = (
    "SELECT TOP 100 "
    "s.ServiceType, s.Name AS APIFeeName, s.Explain AS SampleExplain, "
    "DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) AS CreateTime "
    "FROM ShippingFeeOtherItem s WITH (NOLOCK) "
    "CROSS APPLY (SELECT (s.Id / 4194304) + 1288834974657 AS ms) c "
    "WHERE NOT EXISTS (SELECT 1 FROM MZL_FinanceCustomerBillItem i WITH (NOLOCK) WHERE i.Name = s.Name) "
    "AND s.ServiceType = 'FedEx' "
    "AND s.Name not in ('基础运费','netFreight') "
    "AND DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) > '2025-10-01' "
    "ORDER BY s.ServiceType, s.Name"
)


def log(msg):
    print(msg, flush=True)


def run_query():
    """调容器内 Node CLI 执行查询，返回 rows 列表；失败抛异常。"""
    proc = subprocess.run(
        ["node", CLI, SQL], capture_output=True, text=True, timeout=120
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"查询 CLI 失败: {proc.stderr.strip() or proc.stdout.strip()}"
        )
    return json.loads(proc.stdout).get("rows", [])


def task_recipients():
    """读取本任务（cron 名 = TASK_NAME）配置的 notify_emails。"""
    import sqlite3
    try:
        conn = sqlite3.connect(DB_FILE, timeout=15)
        row = conn.execute(
            "SELECT notify_emails FROM Crontabs WHERE name=? LIMIT 1", (TASK_NAME,)
        ).fetchone()
        conn.close()
        return (row[0] or "").strip() if row else ""
    except Exception as e:  # noqa: BLE001
        log(f"[通知] 读取任务通知邮箱失败: {e}")
        return ""


def push_fbd_task(rows):
    """生成一条待审批 FBD 任务（type=Surcharge）。"""
    import sqlite3
    title = f"新增 Surcharge 项 待确认 ({len(rows)} 条)"
    payload = {"count": len(rows), "rows": rows}
    local_now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    utc = datetime.now(timezone.utc)
    ts = utc.strftime("%Y-%m-%d %H:%M:%S.") + f"{utc.microsecond // 1000:03d} +00:00"
    try:
        conn = sqlite3.connect(DB_FILE, timeout=15)
        conn.execute(
            "INSERT INTO FbdTasks "
            "(title, type, source, payload, status, result, operator, "
            "MZL_PriceID, timestamp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                title,
                FBD_TYPE,
                FBD_SOURCE,
                json.dumps(payload, ensure_ascii=False),
                0,
                "",
                "",
                json.dumps({}),
                local_now,
                ts,
                ts,
            ),
        )
        conn.commit()
        conn.close()
        log(f"[FBD] 已生成待审批任务：{title}")
    except Exception as e:  # noqa: BLE001
        log(f"[FBD] 生成任务失败: {e}")


def try_notify(rows):
    try:
        from notify import send, push_config
        recipients = task_recipients()
        if recipients:
            push_config["SMTP_EMAIL_TO"] = recipients
        preview = "\n".join(
            f"- {r.get('APIFeeName')} ({r.get('ServiceType')})" for r in rows[:20]
        )
        content = (
            f"检测到 {len(rows)} 个新增 FedEx Surcharge 项待确认：\n\n"
            + preview
            + ("\n..." if len(rows) > 20 else "")
            + "\n\n请到 FBD 中心确认。"
        )
        send("FedEx 新增 Surcharge 项待确认", content)
    except Exception as e:  # noqa: BLE001
        log(f"[通知] 发送失败（不影响结果）: {e}")


def main():
    rows = run_query()
    log(f"[查询] 返回 {len(rows)} 行")
    if not rows:
        log("[结果] 无新增 surcharge 项，不建任务、不发邮件。")
        return
    push_fbd_task(rows)
    try_notify(rows)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"[错误] 任务执行失败: {e}")
        sys.exit(1)
```

- [ ] **Step 2: 语法检查（容器内）**

Run:
```bash
docker exec docker-web-1 sh -lc 'python3 -m py_compile /ql/data/scripts/fbd_surcharge_check.py && echo py-OK'
```
Expected: `py-OK`。（脚本在挂载卷，编辑即生效。）

- [ ] **Step 3: 提交**
```bash
git add docker/data/scripts/fbd_surcharge_check.py
git commit -m "feat(fbd): FedEx Surcharge 周检脚本（调 CLI 查询→建任务+邮件）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾：部署 + 注册 cron + 验证（控制方执行，非 subagent）

- [ ] **重建镜像 + 重启**（CLI 编译产物进镜像）
```bash
cd docker && docker compose build > /tmp/b.log 2>&1; echo "exit=$?"
docker compose up -d --force-recreate
```

- [ ] **注册 cron 行**（sqlite 插入；name/command/schedule/notify_emails）。插入后调度服务会纳入；未即时生效则重启或面板触发同步：
```sql
INSERT INTO Crontabs (name, command, schedule, notify_emails, timestamp, created, status, isDisabled, isPinned)
VALUES ('FedEx Surcharge 检查', 'task fbd_surcharge_check.py', '0 8 * * 1', 'kyle@fbdgroups.com',
        <now>, <now>, 1, 0, 0);
```
（实施时用 node/sequelize 或 sqlite3 写入，字段以现有 Crontabs 既有行为准；status/isDisabled 取「空闲/启用」对应值。）

- [ ] **手动验证**：在面板手动「运行」该任务一次 → 看日志：
  - 生产库有命中 → 日志「已生成待审批任务」，FBD 中心出现 type=Surcharge 待审批，且收到邮件；approve 后状态「已通过」、result=`已确认（Surcharge 类型暂无自动处理）`。
  - 无命中 → 日志「无新增 surcharge 项」，不建任务。

## 收尾验证
- [ ] 全部 shared 单测：
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdQuery.test.ts back/shared/fbdCrypto.test.ts back/shared/fbdFuel.test.ts
```
Expected: 全 PASS。
- [ ] `npm run build:back` 通过。
