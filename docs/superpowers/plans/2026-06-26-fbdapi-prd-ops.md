# fbdapi 生产环境操作层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一个内部 prd 操作层（FbdPrdService），由 FBD 中心 approve 调用，把审批通过的 `fedex_fuel_charge` 任务写入 SQL Server 生产库 `MZL_Price`；连接串 AES 加密存 config.sh，要更新的 id 由任务的 `MZL_PriceID` 列携带（调用方决定）。

**Architecture:** 纯逻辑（AES 加解密、百分比/id 解析、更新组装）放 `back/shared/`（node:test 单测）；`FbdPrdService` 持懒连接的 sequelize mssql 实例并执行参数化 UPDATE；`FbdService.approve` 注入它、传 `doc.MZL_PriceID`，替换原占位 `applyUpdate`。一个 CLI 工具把明文连接 JSON 加密成 config.sh 用的密文。

**Tech Stack:** TypeScript + Express + Sequelize 6（mssql 方言 + tedious 驱动）+ typedi；node:test + node:assert；Python 标准库（fuel 脚本）。

**设计文档：** `docs/superpowers/specs/2026-06-26-fbdapi-prd-ops-design.md`

**运行单测：**
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test <测试文件>
```
**编译后端：** `npm run build:back`

---

## 文件结构

- 新增 `back/shared/fbdCrypto.ts`（+ `fbdCrypto.test.ts`）— AES-256-GCM 加解密纯函数
- 新增 `back/shared/fbdFuel.ts`（+ `fbdFuel.test.ts`）— pctToFraction / parseIds / buildFuelUpdates 纯函数
- 新增 `back/scripts/fbd-encrypt.ts` — CLI：明文 → 密文
- 新增 `back/services/fbdPrd.ts` — FbdPrdService：懒连接 + apply/updateFuelSurcharge
- 改 `back/data/fbdTask.ts` — 加 `MZL_PriceID` JSON 字段
- 改 `back/loaders/db.ts` — migrations 给 FbdTasks 补 `MZL_PriceID` 列
- 改 `back/shared/fbd.ts` — 删占位 `applyUpdate`
- 改 `back/shared/fbd.test.ts` — 删 applyUpdate 的 2 条测试
- 改 `back/services/fbd.ts` — approve 注入 FbdPrdService、传 MZL_PriceID
- 改 `package.json` — 新增依赖 `tedious`
- 改 `docker/data/scripts/fedex_fuel_surcharge.py` — push_fbd_task 读 env id 写入 MZL_PriceID

---

## Task 1: AES 加解密纯函数 `back/shared/fbdCrypto.ts`

**Files:**
- Create: `back/shared/fbdCrypto.ts`
- Test: `back/shared/fbdCrypto.test.ts`

- [ ] **Step 1: 写失败的测试**

Create `back/shared/fbdCrypto.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { encrypt, decrypt } from './fbdCrypto';

const KEY = '0'.repeat(64); // 32 字节 hex 测试密钥
const WRONG = '1'.repeat(64);

test('encrypt→decrypt round-trip 还原原文', () => {
  const plain = '{"host":"1.2.3.4","database":"X","password":"p@ss"}';
  const blob = encrypt(plain, KEY);
  assert.notStrictEqual(blob, plain);
  assert.strictEqual(decrypt(blob, KEY), plain);
});

test('同一明文两次密文不同（随机 IV）', () => {
  assert.notStrictEqual(encrypt('abc', KEY), encrypt('abc', KEY));
});

test('错误密钥解密抛错', () => {
  const blob = encrypt('secret', KEY);
  assert.throws(() => decrypt(blob, WRONG));
});

test('篡改密文解密抛错', () => {
  const blob = encrypt('secret', KEY);
  const raw = Buffer.from(blob, 'base64');
  raw[raw.length - 1] ^= 0xff; // 翻转最后一字节
  assert.throws(() => decrypt(raw.toString('base64'), KEY));
});

test('密钥长度不对抛错', () => {
  assert.throws(() => encrypt('x', 'abcd'), /64 位 hex/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdCrypto.test.ts
```
Expected: FAIL，`Cannot find module './fbdCrypto'`。

- [ ] **Step 3: 写实现**

Create `back/shared/fbdCrypto.ts`:
```ts
import crypto from 'crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function keyBuf(keyHex: string): Buffer {
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) {
    throw new Error('FBD_SECRET_KEY 必须是 64 位 hex（32 字节）');
  }
  return buf;
}

// 输出 base64( iv[12] + authTag[16] + ciphertext )
export function encrypt(plaintext: string, keyHex: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blob: string, keyHex: string): string {
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run the same command. Expected: 5 tests pass.

- [ ] **Step 5: 提交**

```bash
git add back/shared/fbdCrypto.ts back/shared/fbdCrypto.test.ts
git commit -m "feat(fbdapi): AES-256-GCM 加解密纯函数 + 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: fuel 纯逻辑 `back/shared/fbdFuel.ts`

**Files:**
- Create: `back/shared/fbdFuel.ts`
- Test: `back/shared/fbdFuel.test.ts`

- [ ] **Step 1: 写失败的测试**

Create `back/shared/fbdFuel.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { pctToFraction, parseIds, buildFuelUpdates } from './fbdFuel';

test('pctToFraction：百分比转小数比例', () => {
  assert.strictEqual(pctToFraction('16.50%'), 0.165);
  assert.strictEqual(pctToFraction('17.00%'), 0.17);
  assert.strictEqual(pctToFraction('0%'), 0);
  assert.strictEqual(pctToFraction('28.5%'), 0.285);
});

test('pctToFraction：非法输入抛错', () => {
  assert.throws(() => pctToFraction('abc'), /无法解析百分比/);
  assert.throws(() => pctToFraction(''), /无法解析百分比/);
});

test('parseIds：逗号分隔去空格去空项', () => {
  assert.deepStrictEqual(parseIds('123,124'), ['123', '124']);
  assert.deepStrictEqual(parseIds(' 1 , ,2 '), ['1', '2']);
  assert.deepStrictEqual(parseIds(''), []);
  assert.deepStrictEqual(parseIds(undefined), []);
});

test('buildFuelUpdates：两条都有 id', () => {
  const r = buildFuelUpdates(
    { ground: '16.50%', express_package: '17.00%' },
    { ground: '1,2', express: '3' },
  );
  assert.deepStrictEqual(r, [
    { label: 'Ground', rate: 0.165, ids: ['1', '2'] },
    { label: 'Express', rate: 0.17, ids: ['3'] },
  ]);
});

test('buildFuelUpdates：仅 ground / 仅 express', () => {
  assert.deepStrictEqual(
    buildFuelUpdates({ ground: '16.50%' }, { ground: '1', express: '' }),
    [{ label: 'Ground', rate: 0.165, ids: ['1'] }],
  );
  assert.deepStrictEqual(
    buildFuelUpdates({ express_package: '17.00%' }, { express: '3' }),
    [{ label: 'Express', rate: 0.17, ids: ['3'] }],
  );
});

test('buildFuelUpdates：都空返回空数组', () => {
  assert.deepStrictEqual(buildFuelUpdates({}, {}), []);
  assert.deepStrictEqual(buildFuelUpdates({ ground: '16.50%' }, {}), []);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdFuel.test.ts
```
Expected: FAIL，`Cannot find module './fbdFuel'`。

- [ ] **Step 3: 写实现**

Create `back/shared/fbdFuel.ts`:
```ts
// 百分比字符串转小数比例："16.50%" -> 0.165；保留 4 位小数避免浮点尾差
export function pctToFraction(s: string): number {
  const n = parseFloat(String(s).replace('%', '').trim());
  if (Number.isNaN(n)) {
    throw new Error(`无法解析百分比: ${s}`);
  }
  return Math.round((n / 100) * 10000) / 10000;
}

// 逗号分隔的 id 串 -> 去空格去空项数组；空/undefined -> []
export function parseIds(val?: string): string[] {
  if (!val) return [];
  return String(val)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export interface FuelUpdate {
  label: string;
  rate: number;
  ids: string[];
}

// 组装要执行的更新：ground 用 payload.ground，express 用 payload.express_package；
// 对应 ids 为空的那条跳过。mzlPriceIds 形如 {ground:"1,2", express:"3"}。
export function buildFuelUpdates(payload: any, mzlPriceIds: any): FuelUpdate[] {
  const ids = mzlPriceIds || {};
  const candidates = [
    { label: 'Ground', pct: payload?.ground, raw: ids.ground },
    { label: 'Express', pct: payload?.express_package, raw: ids.express },
  ];
  const updates: FuelUpdate[] = [];
  for (const c of candidates) {
    const idList = parseIds(c.raw);
    if (idList.length === 0) continue;
    updates.push({ label: c.label, rate: pctToFraction(c.pct), ids: idList });
  }
  return updates;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run the same command. Expected: 6 tests pass.

- [ ] **Step 5: 提交**

```bash
git add back/shared/fbdFuel.ts back/shared/fbdFuel.test.ts
git commit -m "feat(fbdapi): fuel 纯逻辑 pctToFraction/parseIds/buildFuelUpdates + 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: CLI 加密工具 `back/scripts/fbd-encrypt.ts`

**Files:**
- Create: `back/scripts/fbd-encrypt.ts`

- [ ] **Step 1: 写实现**

Create `back/scripts/fbd-encrypt.ts`:
```ts
import { encrypt } from '../shared/fbdCrypto';

const key = process.env.FBD_SECRET_KEY;
const plaintext = process.argv[2];

if (!key) {
  console.error('缺少环境变量 FBD_SECRET_KEY');
  process.exit(1);
}
if (!plaintext) {
  console.error(
    "用法: FBD_SECRET_KEY=<hex> node -r ts-node/register back/scripts/fbd-encrypt.ts '<明文连接JSON>'",
  );
  process.exit(1);
}

console.log(encrypt(plaintext, key));
```

- [ ] **Step 2: 验证 round-trip（用测试密钥，不用真密钥/真密码）**

Run:
```bash
FBD_SECRET_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
  node -r ts-node/register back/scripts/fbd-encrypt.ts '{"host":"x","database":"y"}'
```
Expected: 打印一串 base64 密文（非空、不含明文）。

再验证它能被解回（一条命令，加密后立即解密）：
```bash
TS_NODE_PROJECT=back/tsconfig.json node -r ts-node/register -e "const {encrypt,decrypt}=require('./back/shared/fbdCrypto'); const k='0'.repeat(64); const b=encrypt('{\"host\":\"x\"}',k); console.log('decoded:', decrypt(b,k));"
```
Expected: 打印 `decoded: {"host":"x"}`。

- [ ] **Step 3: 提交**

```bash
git add back/scripts/fbd-encrypt.ts
git commit -m "feat(fbdapi): CLI 加密工具 fbd-encrypt（明文连接串 -> config.sh 密文）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 新增 tedious 依赖（SQL Server 驱动）

**Files:**
- Modify: `package.json`（+ pnpm 锁文件）

- [ ] **Step 1: 安装 tedious**

Run:
```bash
pnpm add tedious
```
Expected: 安装成功，`package.json` 的 dependencies 出现 `tedious`。

- [ ] **Step 2: 验证可加载**

Run:
```bash
node -e "require('tedious'); console.log('tedious OK')"
```
Expected: 打印 `tedious OK`。

- [ ] **Step 3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(fbdapi): 新增 tedious 依赖（SQL Server mssql 方言驱动）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: FbdPrdService `back/services/fbdPrd.ts`

**Files:**
- Create: `back/services/fbdPrd.ts`

- [ ] **Step 1: 写实现**

Create `back/services/fbdPrd.ts`:
```ts
import { QueryTypes, Sequelize } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { decrypt } from '../shared/fbdCrypto';
import { buildFuelUpdates } from '../shared/fbdFuel';

@Service()
export default class FbdPrdService {
  private db?: Sequelize;

  constructor(@Inject('logger') private logger: winston.Logger) {}

  // 懒连接：首次用到时解密 DSN、建连接、authenticate，之后复用
  private async getDb(): Promise<Sequelize> {
    if (this.db) return this.db;
    const enc = process.env.FBD_PRD_DB_DSN_ENC;
    const key = process.env.FBD_SECRET_KEY;
    if (!enc || !key) {
      throw new Error('缺少 FBD_PRD_DB_DSN_ENC 或 FBD_SECRET_KEY');
    }
    const conf = JSON.parse(decrypt(enc, key));
    const db = new Sequelize({
      dialect: 'mssql',
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
    await db.authenticate();
    this.db = db;
    return db;
  }

  // 按任务类型分发；mzlPriceIds 由调用方（approve）从任务 MZL_PriceID 列传入
  public async apply(
    type: string,
    payload: any,
    mzlPriceIds: any,
  ): Promise<string> {
    switch (type) {
      case 'fedex_fuel_charge':
        return this.updateFuelSurcharge(payload, mzlPriceIds);
      default:
        throw new Error(`未知任务类型: ${type}`);
    }
  }

  public async updateFuelSurcharge(
    payload: any,
    mzlPriceIds: any,
  ): Promise<string> {
    const updates = buildFuelUpdates(payload, mzlPriceIds);
    if (updates.length === 0) {
      throw new Error('任务未携带任何 MZL_Priceid（MZL_PriceID 为空）');
    }
    const db = await this.getDb();
    const parts: string[] = [];
    for (const u of updates) {
      // 参数化更新，防注入；IN (:ids) 由 sequelize 展开数组
      const [, affected] = await db.query(
        'update MZL_Price set FuelRate = :rate where MZL_Priceid in (:ids)',
        { replacements: { rate: u.rate, ids: u.ids }, type: QueryTypes.UPDATE },
      );
      // mssql 下受影响行数不一定可靠，取不到就用 ids 数量兜底
      const n = typeof affected === 'number' ? affected : u.ids.length;
      parts.push(`${u.label}=${u.rate} 更新 ${n} 行`);
      this.logger.info(
        '[fbdPrd] fuel %s rate=%s ids=%s',
        u.label,
        u.rate,
        u.ids.join(','),
      );
    }
    return parts.join('；');
  }
}
```

- [ ] **Step 2: 编译后端，确认通过**

Run: `npm run build:back`
Expected: 编译成功，零 TS 错误。

- [ ] **Step 3: 提交**

```bash
git add back/services/fbdPrd.ts
git commit -m "feat(fbdapi): FbdPrdService 懒连接 SQL Server + updateFuelSurcharge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: FbdTask 加 MZL_PriceID 列 + db 迁移

**Files:**
- Modify: `back/data/fbdTask.ts`
- Modify: `back/loaders/db.ts`

- [ ] **Step 1: 模型加字段**

在 `back/data/fbdTask.ts`：

类字段区（`payload?: any;` 之后）加：
```ts
  MZL_PriceID?: any;
```

构造器（`this.payload = options.payload ?? {};` 之后）加：
```ts
    this.MZL_PriceID = options.MZL_PriceID ?? {};
```

`sequelize.define` 的字段对象里（`payload: DataTypes.JSON,` 之后）加：
```ts
  MZL_PriceID: DataTypes.JSON,
```

- [ ] **Step 2: db 迁移补列**

在 `back/loaders/db.ts` 的 `migrations` 数组里追加一项（与其它 `{ table, column, type }` 同级）：
```ts
      { table: 'FbdTasks', column: 'MZL_PriceID', type: 'JSON' },
```

- [ ] **Step 3: 编译后端，确认通过**

Run: `npm run build:back`
Expected: 编译成功，零 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add back/data/fbdTask.ts back/loaders/db.ts
git commit -m "feat(fbdapi): FbdTask 加 MZL_PriceID 列 + db 迁移补列

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 移除占位 applyUpdate + approve 接入 FbdPrdService

**Files:**
- Modify: `back/shared/fbd.ts`
- Modify: `back/shared/fbd.test.ts`
- Modify: `back/services/fbd.ts`

- [ ] **Step 1: 删 fbd.test.ts 里 applyUpdate 的测试（先让测试文件不再引用它）**

在 `back/shared/fbd.test.ts`：

从 import 中删除 `applyUpdate,`（保留 `FbdTaskStatus, FBD_STATUS_LABEL, assertApprovable`）。

删除这两条测试整段：
```ts
test('applyUpdate fedex_rate 返回成功摘要', async () => {
  const r = await applyUpdate('fedex_rate', {});
  assert.match(r, /fedex_rate/);
});

test('applyUpdate 未知类型抛错', async () => {
  await assert.rejects(() => applyUpdate('unknown', {}), /未知任务类型/);
});
```

- [ ] **Step 2: 删 fbd.ts 里的 applyUpdate 函数**

在 `back/shared/fbd.ts` 删除从注释 `// TODO[fbd]: 接真正写 prd 数据库的逻辑。当前为占位框架。` 到该 `applyUpdate` 函数结尾的整段（保留 enum / FBD_STATUS_LABEL / assertApprovable）。

- [ ] **Step 3: approve 改用 FbdPrdService**

在 `back/services/fbd.ts`：

改 import 第 5 行，去掉 `applyUpdate`：
```ts
import { FbdTaskStatus, assertApprovable } from '../shared/fbd';
```

在该 import 区加：
```ts
import FbdPrdService from './fbdPrd';
```

改构造器，注入 FbdPrdService：
```ts
  constructor(
    @Inject('logger') private logger: winston.Logger,
    private fbdPrd: FbdPrdService,
  ) {}
```

改 approve 里调用 applyUpdate 的那行（原 `const result = await applyUpdate(doc.type as string, doc.payload);`）为：
```ts
      const result = await this.fbdPrd.apply(
        doc.type as string,
        doc.payload,
        (doc as any).MZL_PriceID,
      );
```

- [ ] **Step 4: 跑单测，确认 fbd / pageKeys 测试仍通过**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbd.test.ts back/shared/pageKeys.test.ts
```
Expected: 全部 PASS（fbd 测试现在不含 applyUpdate 两条）。

- [ ] **Step 5: 编译后端，确认通过**

Run: `npm run build:back`
Expected: 编译成功，零 TS 错误。

- [ ] **Step 6: 提交**

```bash
git add back/shared/fbd.ts back/shared/fbd.test.ts back/services/fbd.ts
git commit -m "feat(fbdapi): approve 接入 FbdPrdService，移除占位 applyUpdate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: fuel 脚本写入 MZL_PriceID

**Files:**
- Modify: `docker/data/scripts/fedex_fuel_surcharge.py`

- [ ] **Step 1: push_fbd_task 读 env id 并写入 MZL_PriceID 列**

在 `docker/data/scripts/fedex_fuel_surcharge.py` 的 `push_fbd_task` 函数里：

在 `local_now = ...` 这行之前，加组装 MZL_PriceID：
```python
    mzl_price_id = json.dumps(
        {
            "ground": os.environ.get("FEDEX_FUEL_GROUND_ID", ""),
            "express": os.environ.get("FEDEX_FUEL_EXPRESS_ID", ""),
        },
        ensure_ascii=False,
    )
```

把 INSERT 语句的列清单和占位符各加一个 `MZL_PriceID`，并在值元组里加 `mzl_price_id`。改成：
```python
        conn.execute(
            "INSERT INTO FbdTasks "
            "(title, type, source, payload, status, result, operator, "
            "MZL_PriceID, timestamp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                title,
                FBD_TYPE,
                FBD_SOURCE,
                json.dumps(payload, ensure_ascii=False),
                0,  # status=0 待审批
                "",
                "",
                mzl_price_id,
                local_now,
                ts,
                ts,
            ),
        )
```

- [ ] **Step 2: 语法检查（容器内）**

Run:
```bash
docker exec docker-web-1 sh -lc 'python3 -m py_compile /ql/data/scripts/fedex_fuel_surcharge.py && echo py-OK'
```
Expected: 打印 `py-OK`。
（脚本在挂载卷里，编辑即生效，无需重建镜像。）

- [ ] **Step 3: 提交**

```bash
git add docker/data/scripts/fedex_fuel_surcharge.py
git commit -m "feat(fbdapi): fuel 脚本生成任务时写入 MZL_PriceID（从 config.sh 读 id）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾验证

- [ ] 全部纯函数单测：
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbdCrypto.test.ts back/shared/fbdFuel.test.ts back/shared/fbd.test.ts back/shared/pageKeys.test.ts
```
Expected: 全部 PASS。

- [ ] `npm run build:back` 编译通过。

- [ ] **部署 + 配置（需要真值，手动）**：
  1. 用 CLI 生成密文：`FBD_SECRET_KEY=<真key> node -r ts-node/register back/scripts/fbd-encrypt.ts '<真连接JSON>'`
  2. 把 `FBD_SECRET_KEY` / `FBD_PRD_DB_DSN_ENC` / `FEDEX_FUEL_GROUND_ID` / `FEDEX_FUEL_EXPRESS_ID` 填进 `docker/data/config/config.sh`
  3. `cd docker && docker compose build && docker compose up -d`（后端代码 + tedious 进镜像）
  4. 手动跑一次 fuel 任务（或造一条变化）→ 生成带 MZL_PriceID 的待审批任务 → 在 FBD 中心 approve → 核对 prd 库 `MZL_Price.FuelRate` 已更新、任务 result 显示更新行数。

## 后续（不在本期）

- dbquery（只读、仅 Admin）等其它 prd 操作
- 出口/进口费率第三个 id 变量
- 真正的密钥外置（密钥与密文分离）
