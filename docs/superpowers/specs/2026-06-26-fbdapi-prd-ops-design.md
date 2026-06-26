# fbdapi — FBD 生产环境操作层 设计文档

- 日期：2026-06-26
- 分支：feat/rbac-user-role
- 状态：已通过设计评审，待写实现计划

## 1. 背景与目标

FBD 中心的审批流程目前用占位分发器 `applyUpdate`（`back/shared/fbd.ts`），approve 通过后并不真正写生产库。
本功能建一个**内部生产环境操作层 `fbdapi`**：集中所有对 FBD 独立生产数据库（SQL Server）的操作，
由 FBD 中心 approve 调用（**不暴露公开 HTTP 路由**）。首个操作 `updateFuelSurcharge`：
审批通过 `fedex_fuel_charge` 任务时，把燃油附加费率写入生产库 `MZL_Price` 表。

**本期范围：**
- AES-256-GCM 加解密纯函数 + 一个 CLI 工具（把明文连接串加密成 config.sh 用的密文）。
- 新建 `FbdPrdService`：懒连接 SQL Server（sequelize mssql / tedious），承载 prd 操作。
- 用 `FbdPrdService.apply(type, payload)` 替换 `back/shared/fbd.ts` 里的占位 `applyUpdate`，接入 `FbdService.approve`。
- 实现 `updateFuelSurcharge`（写到底）。

**非目标（后续）：** dbquery 等其它 prd 操作；对外公开 HTTP 端点；连接池调优。

## 2. 生产库与连接

- 独立 SQL Server，库 `FBDTest @ 20.163.72.7`。用 sequelize 的 `mssql` 方言（**新增依赖 `tedious`**）。
- 连接参数来自**加密的连接 JSON**，明文形如：
  ```json
  {"host":"20.163.72.7","port":1433,"database":"FBDTest","username":"...","password":"...","encrypt":true,"trustServerCertificate":true}
  ```
  明文只在本地跑 CLI 时输入，**绝不写入源码 / spec / git**。
- 连接策略：**懒连接单例** —— 首次调用 prd 操作时解密、建 sequelize 实例、`authenticate()`；之后复用。

## 3. 加密方案 + CLI 工具

- 算法 **AES-256-GCM**。密钥 = 环境变量 `FBD_SECRET_KEY`（64 位 hex = 32 字节，直接作 AES-256 key）。
- 密文格式：`base64( iv[12] + authTag[16] + ciphertext )`。
- 纯函数 `back/shared/fbdCrypto.ts`：
  - `encrypt(plaintext: string, keyHex: string): string`
  - `decrypt(blob: string, keyHex: string): string`
  - 单测：round-trip（encrypt→decrypt === 原文）；错误密钥 / 篡改密文应抛错（GCM 校验失败）。
- CLI 工具 `back/scripts/fbd-encrypt.ts`（ts-node 运行）：
  ```bash
  FBD_SECRET_KEY=<hex> node -r ts-node/register back/scripts/fbd-encrypt.ts '<明文连接JSON>'
  # stdout 打印密文，粘进 config.sh 的 FBD_PRD_DB_DSN_ENC
  ```
  明文从 argv[2] 读；缺 `FBD_SECRET_KEY` 或缺明文时报错退出。

> 安全说明：本期 `FBD_SECRET_KEY` 与密文 `FBD_PRD_DB_DSN_ENC` 同放 config.sh（用户选择，避免遗忘密钥）。
> 这是**混淆级**防护：能读 config.sh 者即可解密。它防的是"明文密码直接出现在配置里"，不防 config.sh 泄露。

## 4. config.sh 变量

```sh
export FBD_SECRET_KEY="<64位hex>"
export FBD_PRD_DB_DSN_ENC="<CLI 生成的密文>"
export FEDEX_FUEL_GROUND_ID="123,124"     # Ground 费率要更新的 MZL_Priceid，逗号分隔
export FEDEX_FUEL_EXPRESS_ID="456"        # Express 费率要更新的 MZL_Priceid，逗号分隔
```

## 5. FbdPrdService（`back/services/fbdPrd.ts`）

typedi `@Service()`，注入 logger。职责：持有 prd 连接 + 承载 prd 操作。

- `private async getDb()`：懒初始化。读 `FBD_PRD_DB_DSN_ENC` + `FBD_SECRET_KEY` → `decrypt` → 解析连接 JSON →
  `new Sequelize({ dialect:'mssql', host, port, database, username, password, dialectOptions:{ options:{ encrypt, trustServerCertificate } }, logging:false })` →
  `authenticate()`；缓存实例复用。缺少 env 时抛明确错误。
- `public async apply(type: string, payload: any): Promise<string>`：按任务类型分发。
  - `case 'fedex_fuel_charge'` → `updateFuelSurcharge(payload)`
  - `default` → `throw new Error('未知任务类型: ' + type)`
- `public async updateFuelSurcharge(payload: any): Promise<string>`：见第 6 节。

## 6. updateFuelSurcharge 逻辑

纯逻辑抽到 `back/shared/fbdFuel.ts`（可单测），DB 执行留在 service。

- `pctToFraction(s: string): number`：去 `%`、转数值、`/100`。`"16.50%" → 0.165`、`"17.00%" → 0.17`、`"0%" → 0`；
  解析不出数值 → 抛错。（结果按 4 位小数处理，避免浮点尾差）
- `parseIds(envVal: string): string[]`：逗号分隔 → trim → 去空项。`""` → `[]`。
- `buildFuelUpdates(payload, { groundIds, expressIds }): Array<{ label:string; rate:number; ids:string[] }>`：
  组装两条（ground / express），`ids` 为空的那条**跳过**（不进结果）。纯函数，单测。

service 执行（参数化，防注入）：
```sql
update MZL_Price set FuelRate = :rate where MZL_Priceid IN (:ids)
```
- 用 sequelize `query(sql, { replacements:{ rate, ids }, type: QueryTypes.UPDATE })`。
- 对 `buildFuelUpdates` 返回的每条执行一次，累计受影响行数。
- 返回结果串，例：`"Ground=0.165 更新 2 行；Express=0.17 更新 1 行"`（写入 FbdTask.result，审批后可见）。
- 两条都因 id 为空被跳过 → 抛错 `"未配置任何 MZL_Priceid（FEDEX_FUEL_GROUND_ID/FEDEX_FUEL_EXPRESS_ID 均为空）"`。

## 7. 接入 approve + 移除占位

- `back/shared/fbd.ts`：删除占位 `applyUpdate`（及其 2 条单测），保留 `FbdTaskStatus` / `FBD_STATUS_LABEL` / `assertApprovable`。
- `back/services/fbd.ts`：`approve` 不再 import `applyUpdate`；改为注入 `FbdPrdService`，调用 `this.fbdPrd.apply(doc.type, doc.payload)`。
  状态机不变：pending → approving → done(result=apply 返回串) / failed(result=错误信息)。
- **类型对齐**：分发判定用 `'fedex_fuel_charge'`（fuel 脚本 `push_fbd_task` 实际写入的 type），
  纠正原占位用的 `'fedex_rate'` 不一致。

## 8. 错误处理

- 连接失败 / SQL 失败 / env 缺失 / 百分比解析失败 → 抛错；`FbdService.approve` 既有 catch 捕获 →
  任务置 `failed`、`result` 存错误信息，前端详情可见。不影响其它任务。
- 不记录明文密码；任何日志只输出操作摘要与行数。

## 9. 测试

纯函数单测（node:test）：
- `fbdCrypto`：encrypt→decrypt round-trip；错误密钥 / 篡改密文抛错。
- `pctToFraction`：`"16.50%"→0.165`、`"17.00%"→0.17`、`"0%"→0`、非法输入抛错。
- `parseIds`：`"123,124"→["123","124"]`、`" 1 , ,2 "→["1","2"]`、`""→[]`。
- `buildFuelUpdates`：两条都有 id；仅 ground；仅 express；都空（返回空数组）。

DB 执行（`getDb` / 真实 UPDATE）不做单测（需活库，符合本仓库惯例）；用一次性连通性脚本或手动验证。

## 10. 改动文件清单

- 新增 `back/shared/fbdCrypto.ts`（+ `fbdCrypto.test.ts`）
- 新增 `back/shared/fbdFuel.ts`（+ `fbdFuel.test.ts`）
- 新增 `back/services/fbdPrd.ts`
- 新增 `back/scripts/fbd-encrypt.ts`（CLI）
- 改 `back/shared/fbd.ts`（删 applyUpdate）
- 改 `back/shared/fbd.test.ts`（删 applyUpdate 的 2 条测试）
- 改 `back/services/fbd.ts`（approve 调 FbdPrdService）
- 改 `package.json`（新增依赖 `tedious`）
- 文档：config.sh 变量样例（本 spec 第 4 节）

## 11. 后续（不在本期）

- dbquery（只读、仅 Admin）等其它 prd 操作
- 真正的密钥外置（密钥与密文分离）以达到"防泄露"级别
- 出口/进口费率行（第三个 id 变量）
