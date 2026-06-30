# FBD 中心 — 待审批数据更新中心 设计文档

- 日期：2026-06-25
- 分支：feat/rbac-user-role
- 状态：已通过设计评审，待写实现计划

## 1. 背景与目标

定时任务（如 FedEx Rate 抓取）跑完后，部分结果需要**专人人工确认后才能写入 prd 数据库**。
本功能在侧边栏「定时任务」下方新增「FBD 中心」（`/fbd`），提供一个类似定时任务的列表查询界面，
集中展示这些待审批的数据更新任务；Admin 审批通过后，由后端调用更新逻辑写入 prd 数据库。

**本期范围（先搭框架）：** 真实落地 数据模型 / API / RBAC / 五状态状态机 / 前端列表与审批 UI / 种子一条 fedex rate；
**真正写入 prd 数据库的逻辑用占位分发器留 TODO**，接真实逻辑时只改一个函数分支。

非目标（后续独立任务）：
- 改造 `fedex_*.py` 等脚本，使其跑完后自动 push 待审批条目（本期只定好接口与数据结构）。
- 真正的 prd 数据库写入实现。
- 失败条目的「重新审批/重试」（本期失败条目删除重建即可）。

## 2. 数据模型 `FbdTask`

新建 `back/data/fbdTask.ts`，表 `FbdTasks`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK 自增 | |
| `title` | STRING | 标题，如 "FedEx Rate 更新 2026-06" |
| `type` | STRING | 任务类型，如 `fedex_rate`，决定 approve 调哪个更新分支 |
| `source` | STRING | 来源；来源 cron 名（如 `FedEx Fuel Surcharge`），手动建为 `manual` |
| `payload` | JSON | 待写入 prd 的数据（reviewer 核对的内容） |
| `status` | INTEGER | 枚举见下 |
| `result` | TEXT | approve 执行结果 / 错误信息（failed 时存报错） |
| `operator` | STRING | 操作人用户名（approve/reject 的人） |
| `timestamp` | STRING | 创建时间 |

状态枚举：
```ts
export enum FbdTaskStatus { pending, approving, done, failed, rejected }
// 0 待审批 / 1 执行中 / 2 已通过 / 3 失败 / 4 已拒绝
```

在 `back/loaders/db.ts` 加 `await FbdTaskModel.sync();`（放在其它 `.sync()` 之列）。

## 3. 后端 Service + 状态机 + 占位分发器

`back/services/fbd.ts`（typedi `@Service`，注入 sequelize / logger）：

- `list({ searchValue, status, page, size })` — 按 `timestamp` 倒序，支持标题搜索 + 状态过滤
- `get(id)` — 单条（含 payload）
- `create(payload)` — 新建一条 pending（手动建 / 脚本 push 共用）
- `approve(id, operator)` — 状态机核心
- `reject(id, operator)` — pending → rejected
- `remove(ids)` — 批量删除

**approve 状态机：**
```
读取 task → 断言 status === pending（否则报 "非待审批状态，不可审批"）
→ 置 status=approving，写 operator
→ try:  result = await applyUpdate(task.type, task.payload)
        → status=done,  result=成功摘要
   catch(e): status=failed, result=错误信息
→ 保存
```

**占位分发器（同文件，明确标注 TODO）：**
```ts
// TODO[fbd]: 接真正写 prd 数据库的逻辑。当前为占位框架。
async function applyUpdate(type: string, payload: any): Promise<string> {
  switch (type) {
    case 'fedex_rate':
      // TODO: 调用 prd 数据库更新 API / 直连写表
      return 'fedex_rate 占位：已模拟更新成功（未真正写 prd）';
    default:
      throw new Error(`未知任务类型: ${type}`);
  }
}
```
`pending→approving→done` 整条链路是真实的、可见绿；只有 prd 写入是占位。接真实逻辑只改对应 `case`。

## 4. API 路由 + RBAC 接线

`back/api/fbd.ts`，挂 `/api/fbd`，并在 `back/api/index.ts` import + 注册：

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/fbd/tasks` | pageKey `fbd` | 列表（search/status/page/size） |
| GET | `/api/fbd/tasks/:id` | pageKey `fbd` | 详情含 payload |
| POST | `/api/fbd/tasks` | pageKey `fbd` | 新建 / 脚本 push（Joi 校验 title/type/payload） |
| PUT | `/api/fbd/tasks/:id/approve` | fbd 页面权限 | 触发状态机 |
| PUT | `/api/fbd/tasks/:id/reject` | fbd 页面权限 | pending → rejected |

> 更新（2026-06-26）：审批权限由「仅 Admin」改为「有 fbd 页面权限即可」。
> 前端去掉 isAdmin 门，后端 `isAdminOnlyPath` 不再包含 approve/reject（仅 `fbd` pageKey 鉴权）。
| DELETE | `/api/fbd/tasks` | pageKey `fbd` | 批量删除 |

**RBAC 接线（`back/shared/pageKeys.ts`）：**
- `PAGE_KEYS` 加 `'fbd'`
- `PREFIX_MAP` 加 `['/api/fbd', 'fbd']`
- `isAdminOnlyPath` 改造：当前按前缀匹配 `/api/users`、`/api/roles`。approve/reject 是 `/api/fbd/...` 的子路径，
  不能简单加前缀（会把整个 `/api/fbd` 变 Admin-only）。改为**路径模式匹配**：路径以 `/approve` 或 `/reject`
  结尾且位于 `/api/fbd/tasks/` 下时返回 true。这两个端点只有 PUT 方法，无需 method 参与；
  中间件签名 `isAdminOnlyPath(req.path)`（见 `back/loaders/express.ts:142`）保持不变。
  列表/详情/新建/删除仍走 `fbd` pageKey。

## 5. 前端页面 `/fbd`

**菜单**（`src/layouts/defaultProps.tsx`，插在 `/crontab` 之后）：
```tsx
{ path: '/fbd', name: intl.get('FBD 中心'), icon: <IconFont type="ql-icon-crontab" />, component: '@/pages/fbd/index' }
```
图标先复用 crontab 的，后续可换专属图标。

**RBAC 前端接线：**
- `src/layouts/index.tsx` 的 `pathToPageKey` 加 `'/fbd': 'fbd'`
- `src/pages/setting/roleManage.tsx` 的 `PAGE_LABEL_KEY` 加 `fbd: 'FBD 中心'`

**页面 `src/pages/fbd/index.tsx`** — 仿 crontab 查询列表：
- 顶部标题「FBD 中心」+ 搜索框（标题/关键词）+ 状态过滤
- ProTable 列：名称(title)、类型(type)、来源(source)、状态（彩色 Tag：待审批/执行中/已通过/已拒绝/失败）、创建时间、操作
- 操作列：**查看**（详情弹窗，格式化展示 JSON payload）、**通过**、**拒绝**
  - 通过/拒绝仅当 `status===pending` 显示；非 Admin（`user.isAdmin` 为否）隐藏，后端再兜底
  - 走 `PUT .../approve|reject`，带 Popconfirm 二次确认；成功后刷新列表
- 布局复用定时任务页同款容器（`PageContainer` / Fixed contentWidth），宽度与定时任务一致

**详情弹窗：** 展示 title/type/source/status/operator/result + payload（`<pre>` 或 monaco 只读格式化）。

## 6. 种子数据 + 脚本 push 路径

**种子一条 fedex rate**（`back/loaders/db.ts`，`FbdTaskModel.sync()` 后，幂等）：
若 `FbdTasks` 表为空，插入：
```
title: 'FedEx Rate 更新（示例）'
type:  'fedex_rate'
source:'manual'
payload:{ note: '示例待审批数据，approve 后走占位更新', rates: {} }
status: pending
```
「表为空才插」保证重启不重复；真实数据后续由脚本 push 覆盖。

**脚本 push 路径（为长期「定时任务推送」留好）：**
定时任务脚本跑完后，用青龙 open API token（Bearer）`POST /api/fbd/tasks` 推一条 pending。
本期不改脚本，只定好接口与数据结构，文档给 curl 示例；脚本接入作为后续独立任务。

```bash
curl -X POST "$QL_URL/api/fbd/tasks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"FedEx Rate 更新 2026-07","type":"fedex_rate","source":"FedEx Fuel Surcharge","payload":{...}}'
```

## 7. 错误处理

- approve 时 `status!==pending` → 返回明确错误，前端 toast，不改状态
- `applyUpdate` 抛错 → status=failed，result 存错误信息，前端详情可见
- 本期失败条目不做「重新审批」，删除重建即可（状态机保持单向简单）
- 所有写操作记 logger；approve/reject 记 operator

## 8. 测试

Service 层状态机单测：
- pending → approve → done（applyUpdate 成功）
- pending → approve → failed（applyUpdate 抛错）
- 非 pending 状态 approve → 抛错、状态不变
- pending → reject → rejected

## 9. 改动文件清单

后端：
- 新增 `back/data/fbdTask.ts`
- 新增 `back/services/fbd.ts`
- 新增 `back/api/fbd.ts`
- 改 `back/api/index.ts`（注册路由）
- 改 `back/loaders/db.ts`（sync + 种子）
- 改 `back/shared/pageKeys.ts`（PAGE_KEYS / PREFIX_MAP / isAdminOnlyPath）

前端：
- 新增 `src/pages/fbd/index.tsx`（+ 详情弹窗组件）
- 改 `src/layouts/defaultProps.tsx`（菜单）
- 改 `src/layouts/index.tsx`（pathToPageKey）
- 改 `src/pages/setting/roleManage.tsx`（PAGE_LABEL_KEY）

---

## 10. 增量（2026-06-26）：创建表单 + 状态分类 Tab

在第一期「列表 + 详情 + 审批」基础上，补齐两项，使 FBD 中心与「定时任务」页一致：**可查询、可创建、按状态分类**。后端列表/创建接口本就存在，主要是前端 UI + 一处列表多状态过滤。

### 10.1 状态分类 Tab（替换原「状态下拉过滤」）

5 个底层状态归到 3 个 Tab（无「全部」页签），默认选「待处理」：

| Tab | 含底层状态 | 传给后端的 `status` |
|-----|-----------|------------------|
| 待处理 | 待审批(0) + 执行中(1) | `0,1` |
| 已完成 | 已通过(2) | `2` |
| 处理失败 | 失败(3) + 已拒绝(4) | `3,4` |

切 Tab → 回第 1 页 → 按该组状态重新拉列表。

**后端 `list` 改为支持多状态**（`back/services/fbd.ts`）：`status` 参数接收逗号分隔串，
解析为数字数组——长度 1 用等值，>1 用 `Op.in`；空/非法忽略。`back/api/fbd.ts` 的 GET `/tasks`
不再对 `status` 做 `Number()`，原样把字符串传给 service。create/approve/reject/detail 不变。

### 10.2 创建任务

标题栏右侧加「创建任务」主按钮（仿定时任务），弹出表单 Modal：

| 字段 | 控件 | 规则 |
|------|------|------|
| 名称 | Input | 必填 |
| 类型 | Select | 必填。预设 `fedex_fuel_charge`(FedexFuelCharge) / `sql_monitor`(Sql Monitor) / `fedex_zone`(Fedex Zone) / 自定义 |
| 自定义类型 | Input | 仅「类型=自定义」时显示，必填，存任意字符串 |
| 来源 | Input | 选填，默认 `manual` |
| payload | TextArea | 选填，提交前 `JSON.parse` 校验，非法则提示不提交 |

提交 → `POST /api/fbd/tasks` → 成功后关弹窗、跳「待处理」Tab、刷新（新条目恒为待审批）。

> 注意：`applyUpdate` 目前只认 `fedex_rate`，新类型 approve 时会落 default 分支转 failed。
> 与占位设计一致——接真实写库逻辑时给每个 `case` 补分支即可，本期不接。

### 10.3 改动文件（增量）
- 改 `src/pages/fbd/index.tsx`（Tab + 创建表单 Modal）
- 改 `back/services/fbd.ts`（`list` 支持逗号分隔多状态）
- 改 `back/api/fbd.ts`（GET `/tasks` 的 `status` 原样传字符串）
