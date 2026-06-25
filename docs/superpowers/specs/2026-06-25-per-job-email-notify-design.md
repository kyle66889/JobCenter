# 每个任务的专属邮件通知名单 设计文档

**日期：** 2026-06-25
**分支建议：** `feat/per-job-email-notify`

## 目标

给每个定时任务（cron job）增加一个**专属邮件收件人名单**。任务每次跑完（无论成功或失败），面板自动把「执行结果摘要 + 日志末尾若干行」邮件发给该任务自己配置的名单。未配置名单的任务不受影响（纯 opt-in）。

## 背景 / 现状

- 目前**面板自身不发任务完成通知**，所有任务通知都是脚本内部主动调 `sendNotify`（`sample/notify.js` / `notify.py`）发出，读取的是**全局**通知配置。
- 任务的实际执行统一走 `CronService.runSingle(cronId)`（`back/services/cron.ts:584`），手动「运行」与定时触发都经过它。
- `runSingle` 内的 `cp.on('exit', code => …)`（`cron.ts:655`）是任务完成的唯一汇聚点，此处可拿到：`cron`（任务行）、退出码 `code`、本次运行日志文件绝对路径 `absolutePath`、起止时间。
- 通知服务 `NotificationService.notify(title, content, notificationInfo?)`（`back/services/notify.ts:51`）支持用 `notificationInfo` **覆盖**全局配置：传入 `{ type:'email', emailTo }` 时，会复用全局 SMTP 凭据（`emailService/emailUser/emailPass`），仅覆盖渠道与收件人。
- 邮件多收件人解析 `parseMailRecipients`（`notify.ts:95`）已存在：按 `;`/`；` 分隔、去空格、去空项。

## 方案

**面板侧在 `runSingle` 的完成回调里发邮件（方案 A）。**

任务跑完时，若该任务配置了 `notify_emails`，面板读取日志末尾 N 行 + 拼摘要，调用 `notify(title, content, { type:'email', emailTo: 任务名单 })`，复用全局 SMTP，发给该任务名单。

已否决的替代方案：
- **脚本侧改 notify 助手**：需改 `notify.js` 与 `notify.py` 两个助手 + 注入环境变量，且仅在脚本主动调 notify 时才触发，杂乱不可控。
- **每个任务配整套独立通知渠道**：超出需求（只要邮箱），过度设计。

## 详细设计

### 1. 数据模型

- `Crontab` 模型（`back/data/cron.ts`）新增字段 `notify_emails?: string`，列类型 `VARCHAR(255)`，存储分号分隔的收件人字符串。
- `back/loaders/db.ts` 迁移数组追加：`{ table: 'Crontabs', column: 'notify_emails', type: 'VARCHAR(255)' }`（已有 ALTER 迁移机制，重启自动加列）。

### 2. 触发逻辑（核心）

在 `CronService.runSingle` 的 `cp.on('exit', async (code) => { … })` 内、现有状态更新之后、`resolve(...)` 之前，追加一段，整段用 `try/catch` 包裹，**任何失败都不得影响任务完成流程**：

1. 若 `cron.notify_emails` 解析后为空 → 直接跳过（opt-in）。
2. 组装内容：
   - 标题：成功 `✅ [任务名] 执行成功`，失败 `❌ [任务名] 执行失败`（失败判据：`code !== 0`）。
   - 正文摘要：任务名、状态、耗时（`finishedAt - startedAt`）、完成时间。
   - 日志末尾 N 行：读取 `absolutePath`，取最后 N 行附在摘要之后；文件读不到或为空则只发摘要。
3. 调 `this.notificationService.notify(title, content, { type: 'email', emailTo: cron.notify_emails })`（fire-and-forget，不 await 阻塞任务结束亦可，但需 catch）。

`CronService` 通过 typedi 注入 `NotificationService`（参照其它 service 的 `@Inject`）。

### 3. 日志读取

- 新增一个小工具：读取指定日志文件的末尾 N 行。N 为常量，**默认 50**。
- 仅在 `notify_emails` 非空时才读，避免无谓 IO。

### 4. API

- 任务创建 / 更新接口（`back/api/cron.ts`）的 celebrate/Joi 校验放行 `notify_emails`（可选字符串，允许空串），并随任务一起持久化。

### 5. 前端

- 任务新建 / 编辑弹窗（`src/pages/crontab/modal.tsx` 或对应文件）增加一个「通知邮箱」输入框：
  - 字段名 `notify_emails`，多个邮箱用分号 `;` 分隔。
  - 提示文案参照全局 emailTo：「任务完成后通知的邮箱，多个分号分隔，留空则不发」。
- 不新增列表列、不加额外指示（YAGNI）。

### 6. 前置条件（写入用户文档/提示）

- 需在「系统设置 → 通知设置 → 邮箱」中**填过 SMTP**（`emailService` / `emailUser` / `emailPass`）至少一次——即使全局通知方式不是邮箱也可，配置会被复用。
- 若未配置 SMTP，`email()` 发送会失败并被 catch，仅记录日志，不影响任务。

## 错误处理

- `notify_emails` 为空 → 跳过。
- 日志文件缺失/不可读 → 只发摘要。
- 邮件发送异常（含 SMTP 未配置）→ try/catch 吞掉 + 记日志，绝不影响任务完成与状态更新。

## 测试

- `parseMailRecipients` 已有单测覆盖分隔逻辑，无需新增。
- 末尾 N 行读取工具：可加纯逻辑单测（给定多行文本取最后 N 行、行数不足、空文件）。
- 集成冒烟（手动）：给某任务配 `notify_emails`，手动运行一次，确认收到含摘要 + 日志末尾的邮件；成功与失败各验一次；未配置的任务确认面板不发邮件。

## 不在本期范围

- 每任务的非邮件渠道（Telegram/钉钉等）。
- 每任务独立 SMTP 凭据（统一复用全局）。
- 通知频率限制 / 去重 / 仅失败开关（本期为「成功失败都发」固定语义）。
- 脚本侧 `sendNotify` 行为不变。
