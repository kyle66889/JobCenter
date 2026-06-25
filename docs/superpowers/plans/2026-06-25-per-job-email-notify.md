# 每个任务专属邮件通知名单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每个定时任务增加专属邮件收件人名单（`notify_emails`），任务跑完时面板按该名单发「结果摘要 + 日志末尾 50 行」邮件，成功失败都发，纯 opt-in。

**Architecture:** 在 `CronService.runSingle` 的 `cp.on('exit')` 完成回调里注入发送逻辑：读该任务 `notify_emails`，非空则读日志末尾 50 行 + 拼摘要，调 `NotificationService.notify(title, content, {type:'email', emailTo})`，复用全局 SMTP、仅覆盖收件人。任务表加 `notify_emails` 列，API 校验放行，前端编辑弹窗加输入框。

**Tech Stack:** Node + TypeScript、Express、Sequelize(SQLite)、typedi、celebrate(Joi)、nodemailer；前端 umi + React + antd；纯逻辑单测用 `node:test`；Docker 多阶段构建部署。

**Spec:** `docs/superpowers/specs/2026-06-25-per-job-email-notify-design.md`

## 工具链命令

- **纯逻辑单测**：`TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test <test文件>`
- **后端编译校验**：`npx tsc --noEmit -p back/tsconfig.json`
- **构建+部署（含前端 max build）**：`cd docker && docker compose up -d --build`

## 文件结构

**新增**
- `back/shared/logTail.ts` — 纯函数：取文本末尾 N 行（纯逻辑，单测）
- `back/shared/logTail.test.ts` — 单测

**修改**
- `back/data/cron.ts` — Crontab 加 `notify_emails` 字段 + 列 + 构造函数
- `back/loaders/db.ts` — 加 `Crontabs.notify_emails` 列迁移
- `back/validation/schedule.ts` — `commonCronSchema` 放行 `notify_emails`
- `back/services/cron.ts` — 注入 `NotificationService`，在 `runSingle` 完成回调发邮件
- `src/pages/crontab/modal.tsx` — 任务编辑弹窗加「通知邮箱」输入框

---

## Task 1: 日志末尾 N 行纯函数（TDD）

**Files:**
- Create: `back/shared/logTail.ts`
- Test: `back/shared/logTail.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// back/shared/logTail.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { tailLines } from './logTail';

test('行数超过 N 时取最后 N 行', () => {
  const text = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
  assert.strictEqual(tailLines(text, 2), 'l4\nl5');
});

test('行数不足 N 时全返回', () => {
  assert.strictEqual(tailLines('a\nb', 5), 'a\nb');
});

test('忽略末尾空行', () => {
  assert.strictEqual(tailLines('a\nb\n\n', 2), 'a\nb');
});

test('空内容返回空串', () => {
  assert.strictEqual(tailLines('', 50), '');
  assert.strictEqual(tailLines(undefined as any, 50), '');
});

test('兼容 CRLF', () => {
  assert.strictEqual(tailLines('a\r\nb\r\nc', 2), 'b\nc');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/logTail.test.ts`
Expected: FAIL（`Cannot find module './logTail'`，用例全挂）

- [ ] **Step 3: 写实现**

```ts
// back/shared/logTail.ts
// 取文本末尾 N 行（忽略末尾连续空行），用于任务完成邮件附日志尾部
export function tailLines(content: string, n: number): string {
  if (!content) return '';
  const lines = content.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-n).join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/logTail.test.ts`
Expected: PASS（tests 5 / fail 0）

- [ ] **Step 5: 提交**

```bash
git add back/shared/logTail.ts back/shared/logTail.test.ts
git commit -m "feat: 日志末尾 N 行纯函数 tailLines"
```

---

## Task 2: Crontab 模型加 notify_emails 字段 + 迁移

**Files:**
- Modify: `back/data/cron.ts`
- Modify: `back/loaders/db.ts`

- [ ] **Step 1: 类字段**

在 `back/data/cron.ts` 的 `Crontab` 类，`work_dir?: string;`（第 26 行）之后加：

```ts
  notify_emails?: string;
```

- [ ] **Step 2: 构造函数赋值**

在构造函数 `this.work_dir = options.work_dir;`（第 53 行）之后加：

```ts
    this.notify_emails = options.notify_emails;
```

- [ ] **Step 3: sequelize 列定义**

在 `CrontabModel` 定义里 `work_dir: DataTypes.STRING,`（第 95 行）之后加：

```ts
  notify_emails: DataTypes.STRING,
```

- [ ] **Step 4: 加列迁移**

在 `back/loaders/db.ts` 的 `migrations` 数组里、`{ table: 'Users', column: 'avatar', type: 'VARCHAR(255)' },` 之后加：

```ts
      { table: 'Crontabs', column: 'notify_emails', type: 'VARCHAR(255)' },
```

- [ ] **Step 5: 编译校验**

Run: `npx tsc --noEmit -p back/tsconfig.json`
Expected: 无新增 error

- [ ] **Step 6: 提交**

```bash
git add back/data/cron.ts back/loaders/db.ts
git commit -m "feat: Crontab 加 notify_emails 列(任务专属邮件名单)"
```

---

## Task 3: API 校验放行 notify_emails

**Files:**
- Modify: `back/validation/schedule.ts`

> `commonCronSchema` 同时用于创建(POST)与更新(PUT)任务（`back/api/cron.ts:179,327`），创建/更新走 `new Crontab(payload)`，构造函数已在 Task 2 拷贝该字段，故只需放行校验。

- [ ] **Step 1: 加字段到 commonCronSchema**

在 `back/validation/schedule.ts` 的 `commonCronSchema` 对象里、`task_before` 同级（紧随其后）加：

```ts
  notify_emails: Joi.string().optional().allow('').allow(null),
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p back/tsconfig.json`
Expected: 无新增 error

- [ ] **Step 3: 提交**

```bash
git add back/validation/schedule.ts
git commit -m "feat: 任务创建/更新校验放行 notify_emails"
```

---

## Task 4: CronService 完成回调发邮件

**Files:**
- Modify: `back/services/cron.ts`

> 在 `runSingle` 的 `cp.on('exit', async (code) => {...})` 里、现有状态更新之后、`resolve(...)` 之前注入。该作用域内可用：`cron`(第587行加载)、`code`、`startedAt`(第622行)、`finishedAt`(第662行)、`absolutePath`(第613行)。`notify()` 会用全局通知配置的 SMTP 凭据 + 覆盖收件人/渠道（`back/services/notify.ts:56-67`）。

- [ ] **Step 1: 加 import**

在 `back/services/cron.ts` 顶部 import 段加：

```ts
import NotificationService from './notify';
import { NotificationMode, NotificationInfo } from '../data/notify';
import { tailLines } from '../shared/logTail';
```

- [ ] **Step 2: 注入 NotificationService**

把类构造函数（第 38 行）

```ts
  constructor(@Inject('logger') private logger: winston.Logger) { }
```

改为：

```ts
  @Inject((type) => NotificationService)
  private notificationService!: NotificationService;

  constructor(@Inject('logger') private logger: winston.Logger) { }
```

- [ ] **Step 3: 在 exit 回调注入发送逻辑**

在 `runSingle` 的 `cp.on('exit', async (code) => {`内，把现有的

```ts
          resolve({ ...params, pid: cp.pid, code });
```

替换为（保留 resolve，在其前加发送逻辑）：

```ts
          // 任务专属邮件通知：配了 notify_emails 才发，成功失败都发（opt-in）
          try {
            const recipients = (cron.notify_emails || '')
              .split(/[;；]/)
              .map((s) => s.trim())
              .filter(Boolean);
            if (recipients.length) {
              const ok = code === 0;
              const durationSec = finishedAt - startedAt;
              const name = cron.name || `#${cron.id}`;
              const title = `${ok ? '✅' : '❌'} [${name}] ${
                ok ? '执行成功' : '执行失败'
              }`;
              let tail = '';
              try {
                const logContent = await fs.readFile(absolutePath, 'utf-8');
                tail = tailLines(logContent, 50);
              } catch (e) {
                this.logger.warn('任务邮件通知读日志失败: %o', e);
              }
              const summary =
                `任务：${name}\n` +
                `状态：${ok ? '成功' : '失败'}（退出码 ${code}）\n` +
                `耗时：${durationSec}s\n` +
                `完成时间：${dayjs(finishedAt * 1000).format(
                  'YYYY-MM-DD HH:mm:ss',
                )}`;
              const content = tail
                ? `${summary}\n\n—— 日志末尾 50 行 ——\n${tail}`
                : summary;
              this.notificationService
                .notify(title, content, {
                  type: NotificationMode.email,
                  emailTo: recipients.join(';'),
                } as unknown as NotificationInfo)
                .catch((e) =>
                  this.logger.error('任务邮件通知发送失败: %o', e),
                );
            }
          } catch (e) {
            this.logger.error('任务邮件通知异常: %o', e);
          }

          resolve({ ...params, pid: cp.pid, code });
```

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit -p back/tsconfig.json`
Expected: 无新增 error

- [ ] **Step 5: 提交**

```bash
git add back/services/cron.ts
git commit -m "feat: 任务跑完按 notify_emails 发结果+日志末尾邮件"
```

---

## Task 5: 前端任务弹窗加「通知邮箱」输入框

**Files:**
- Modify: `src/pages/crontab/modal.tsx`

> `handleOk` 用 `...values` 拼 payload（第 30 行），表单字段名 = cron 属性名即可随提交带上、编辑时自动回填。无需改 `handleOk`。

- [ ] **Step 1: 加 Form.Item**

在 `src/pages/crontab/modal.tsx` 的 `name="log_name"` 那个 `Form.Item`（第 199 行起）**之后**、`</Form>` 之前，加：

```tsx
        <Form.Item
          name="notify_emails"
          label={intl.get('通知邮箱')}
          tooltip={intl.get(
            '任务每次执行完成后，把结果摘要和日志末尾发到这些邮箱；多个用分号分隔，留空则不发。需先在系统设置-通知设置-邮箱里配好 SMTP',
          )}
        >
          <Input placeholder="alice@example.com;bob@example.com" />
        </Form.Item>
```

> 确认 `Input` 已在该文件顶部从 `antd` 引入（第 167-179 行的命令/名称字段已用 `Input`，故已引入，无需重复 import）。

- [ ] **Step 2: 加 i18n 词条**

在 `src/locales/zh-CN.json` 加（值同 key）：

```json
  "通知邮箱": "通知邮箱",
```

在 `src/locales/en-US.json` 加：

```json
  "通知邮箱": "Notify Emails",
```

> 注意：加到各 json 现有条目中间，保证 JSON 合法（末尾条目需补逗号）。tooltip 文案未单列 key，`intl.get` 找不到会回退显示中文原文，可接受。

- [ ] **Step 3: 构建校验（随 Task 6 的 docker 构建一并验证；此处可跳过本地构建）**

- [ ] **Step 4: 提交**

```bash
git add src/pages/crontab/modal.tsx src/locales/zh-CN.json src/locales/en-US.json
git commit -m "feat: 任务弹窗加通知邮箱输入框"
```

---

## Task 6: 构建部署 + 端到端冒烟

**Files:** 无（验证用）

- [ ] **Step 1: 构建并部署**

Run: `cd docker && docker compose up -d --build`
Expected: 构建成功（前端 max build + 后端 tsc 通过），容器重启 healthy。

- [ ] **Step 2: 确认列已加**

Run:
```bash
sqlite3 docker/data/db/database.sqlite "PRAGMA table_info(Crontabs);" | grep notify_emails
```
Expected: 输出含 `notify_emails|VARCHAR(255)`。

- [ ] **Step 3: 前置——确认全局邮箱 SMTP 已配置**

> 浏览器进「系统设置 → 通知设置 → 邮箱」，填好 `emailService`/`emailUser`/`emailPass` 并保存（测试通知通过）。这是发件凭据来源。

- [ ] **Step 4: 给某任务配通知邮箱并手动运行**

> 浏览器编辑一个任务（如「FedEx Zone Chart」），在「通知邮箱」填**你自己的邮箱**，保存；然后点「运行」。
> Expected：任务跑完后，该邮箱收到标题 `✅/❌ [任务名] 执行成功/失败`、正文含摘要 + 日志末尾若干行的邮件。

- [ ] **Step 5: 验证 opt-in（未配置不发）**

> 运行一个**没填**通知邮箱的任务，确认不产生任何面板邮件。
> Expected：无邮件。

- [ ] **Step 6: 验证失败场景**

> 给一个会失败的任务（如命令 `exit 1` 或不存在的脚本）配上你的邮箱并运行。
> Expected：收到 `❌ … 执行失败（退出码 1）` 的邮件，正文含日志末尾。

- [ ] **Step 7: 记录结果**（无代码提交；如有缺陷回对应 Task 修复）

---

## 备注 / 风险

- **发件凭据**：复用全局通知设置里的邮箱 SMTP（`emailService/emailUser/emailPass`），即使全局通知方式不是邮箱也会被复用；若从未配置，`notify` 内 `email()` 会抛错并被 catch，仅记日志、不影响任务。
- **频繁任务**：成功失败都发，跑得频繁的任务邮件会多——本期按需求固定此语义，后续如需「仅失败」开关再单独加。
- **`makeCommand`/调度模式**：本改动只在 `runSingle` 完成点注入，不动调度逻辑；系统 crond 与 node 调度两种模式最终都经 `runSingle`。
