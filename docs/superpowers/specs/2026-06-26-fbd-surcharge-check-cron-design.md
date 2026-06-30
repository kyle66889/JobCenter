# FBD Surcharge 周检定时任务 设计文档

- 日期：2026-06-26
- 分支：feat/rbac-user-role
- 状态：已通过设计评审，待写实现计划

## 1. 背景与目标

每周一早 8 点查生产库（SQL Server），找出 `ShippingFeeOtherItem` 里 FedEx 的、尚未进
`MZL_FinanceCustomerBillItem` 的新增 surcharge 项；**若有数据**，在 FBD 中心生成一条
待审批任务（type `Surcharge`）并发邮件提醒。审批通过只做「确认」，不自动写生产库（处理逻辑后续再定）。

复用已实现的查询能力（`validateSqlQuery` + prd 连接），定时脚本在**容器内**通过 Node CLI 调用，
不走 HTTP（cron 进程无用户 JWT，见第 7 节决策依据）。

**本期不包括：** approve 后对生产库的实际写入（Surcharge 暂仅确认）；前端改动。

## 2. 调用方式：容器内 Node CLI

定时脚本是容器内进程，没有登录用户的 JWT，无法调 `/api/fbd/query`（该路由要 `req.auth.userId`）。
`Crontab` 表也无「创建用户」字段，任务不绑定用户身份。故采用**容器内 Node CLI**，复用同一套校验+连接逻辑，零 token。

### 2.1 抽出连接构建（DRY）：`back/services/fbdPrdConn.ts`（新增）

把现在内联在 `back/services/fbdPrd.ts` 的连接逻辑抽成独立模块，供 `FbdPrdService` 和 CLI 共用：

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

`FbdPrdService.getDb` 改为：缺连接时 `db = createPrdSequelize(); await db.authenticate(); this.db = db;`（保留原有 try/catch 关闭逻辑与缓存）。删除 fbdPrd.ts 里原内联的 readConfigShVar/getConf/loadTedious。

### 2.2 CLI：`back/scripts/fbd-query.ts`（新增，编译进镜像）

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

编译产物：`/ql/static/build/scripts/fbd-query.js`（`npm run build:back` 输出）。
定时脚本调用：`node /ql/static/build/scripts/fbd-query.js "<sql>"`。

## 3. 定时脚本：`docker/data/scripts/fbd_surcharge_check.py`（新增）

```
new Env('FedEx Surcharge 检查')
cron: 0 8 * * 1
```

- 内置 SQL（**去掉了 `-- 4194304 = 2^22` 注释和末尾 `;`**，否则过不了校验）：
  ```sql
  SELECT TOP 100
      s.ServiceType, s.Name AS APIFeeName, s.Explain AS SampleExplain,
      DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) AS CreateTime
  FROM ShippingFeeOtherItem s WITH (NOLOCK)
  CROSS APPLY (SELECT (s.Id / 4194304) + 1288834974657 AS ms) c
  WHERE NOT EXISTS (SELECT 1 FROM MZL_FinanceCustomerBillItem i WITH (NOLOCK) WHERE i.Name = s.Name)
      AND s.ServiceType = 'FedEx'
      AND s.Name not in ('基础运费','netFreight')
      AND DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) > '2025-10-01'
  ORDER BY s.ServiceType, s.Name
  ```
  （SELECT 开头、TOP 100、WITH(NOLOCK)、无注释/分号/写关键字 → 通过校验）
- 用 `subprocess` 调 CLI，`stdout` 解析为 `{rows, count}`。CLI 非 0 退出 → 记日志并以失败退出（不建任务）。
- `count == 0` → 记「无新增 surcharge 项」，正常退出，**不建任务、不发邮件**。
- `count > 0`：
  - **① 生成 FBD 待审批**（直连 `/ql/data/db/database.sqlite`，与 fuel 脚本同款 INSERT，11 列含 `MZL_PriceID`）：
    - title：`新增 Surcharge 项 待确认 (<count> 条)`
    - type：`Surcharge`
    - source：`FedEx Surcharge 检查`
    - payload：`{ "count": <n>, "rows": <CLI 返回的 rows> }`
    - status：0；MZL_PriceID：`{}`
  - **② 发邮件**：用青龙 `notify`，标题 `FedEx 新增 Surcharge 项待确认`，正文含条数 + 前若干行摘要 + 「请到 FBD 中心确认」；收件人取本任务 `notify_emails`（同 fuel：读 Crontabs.notify_emails，写入 `push_config['SMTP_EMAIL_TO']`，为空回退 config.sh）。
- 失败隔离：CLI/DB/通知任一异常都不让整个任务崩（记日志即可），与 fuel 脚本一致。

## 4. approve 处理：`FbdPrdService.apply` 加 Surcharge 分支

```ts
case 'Surcharge':
  return '已确认（Surcharge 类型暂无自动处理）';
```
不连生产库；approve → 状态「已通过」、result 为该串。reject 不变。

## 5. 注册 cron

插一条 Crontab 行并让青龙同步：
- name：`FedEx Surcharge 检查`
- command：`task fbd_surcharge_check.py`
- schedule：`0 8 * * 1`
- notify_emails：`kyle@fbdgroups.com`

实施时通过 sqlite 插入（与既有任务同表），插入后调度服务会把它纳入 crontab；若未即时生效，重启容器或在面板触发一次同步。

## 6. 部署

- 改了 back/（新增 fbdPrdConn.ts、fbd-query.ts；改 fbdPrd.ts）→ **重建镜像**（CLI 编译进 `/ql/static/build`）。
- python 脚本在挂载卷 → 即时。
- Crontab 行入库。

## 7. 决策依据（鉴权）

- `Crontab` 无 user/owner 字段，任务不绑定创建用户；cron 由 `task.sh` 拉起，进程无用户 JWT。
- `/api/fbd/query` 要 `req.auth.userId`（登录 JWT），脚本没有。
- `/ql/data/config/token.json` 是系统级 open-API token，仅作用于 `/open/...`；本期不新增 open 路由。
- 故选**容器内 Node CLI**：无 token、无路由改动，复用同一 `validateSqlQuery` + `createPrdSequelize`。

## 8. 测试

- `validateSqlQuery` 已有单测；额外补一条：本任务的真实 SQL（去注释/分号后）`validateSqlQuery(sql).ok === true`（防回归，确保查询不被误拦）。
- `createPrdSequelize` / CLI / 脚本：DB 依赖，不做单测；用一次性连通 + 手动跑脚本验证（造数据看是否生成任务+邮件）。

## 9. 改动文件清单

- 新增 `back/services/fbdPrdConn.ts`
- 新增 `back/scripts/fbd-query.ts`
- 新增 `docker/data/scripts/fbd_surcharge_check.py`
- 改 `back/services/fbdPrd.ts`（用 createPrdSequelize；apply 加 Surcharge 分支；删内联连接 helper）
- 新增/改 `back/shared/fbdQuery.test.ts`（补真实 SQL 通过校验的断言）
- Crontab 行入库（部署步骤）
