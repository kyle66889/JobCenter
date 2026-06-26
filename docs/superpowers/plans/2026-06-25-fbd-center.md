# FBD 中心（待审批数据更新中心）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧边栏「定时任务」下新增「FBD 中心」（`/fbd`），集中展示待人工审批后写入 prd 数据库的任务，Admin 审批后触发更新逻辑（本期为占位框架）。

**Architecture:** 沿用 qinglong 既有分层——纯逻辑放 `back/shared/`（可用 node:test 单测），数据模型 `back/data/`，业务 `back/services/`，路由 `back/api/`，前端页面 `src/pages/`。审批走五状态状态机；真正写 prd 的逻辑用占位分发器 `applyUpdate` 留 TODO，接真实逻辑时只改一个 `case`。

**Tech Stack:** TypeScript + Express + Sequelize + typedi（后端）；UmiJS/React + Ant Design Pro（前端）；node:test + node:assert（单测）。

**设计文档：** `docs/superpowers/specs/2026-06-25-fbd-center-design.md`

**运行单测的命令（本仓库 node:test 约定）：**
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test <测试文件>
```
**编译后端：** `npm run build:back`（`tsc -p back/tsconfig.json`，已排除 `**/*.test.ts`）

---

## 文件结构

后端：
- 新增 `back/shared/fbd.ts` — 纯逻辑：状态枚举、状态标签、`assertApprovable`、占位分发器 `applyUpdate`
- 新增 `back/shared/fbd.test.ts` — 上述纯逻辑单测
- 修改 `back/shared/pageKeys.ts` — 注册 `fbd` pageKey、`/api/fbd` 前缀、approve/reject 的 Admin-only 规则
- 修改 `back/shared/pageKeys.test.ts` — 补 fbd 相关断言
- 新增 `back/data/fbdTask.ts` — `FbdTask` 模型
- 新增 `back/services/fbd.ts` — list/get/create/approve/reject/remove
- 新增 `back/api/fbd.ts` — REST 路由
- 修改 `back/api/index.ts` — 注册路由
- 修改 `back/loaders/db.ts` — sync + 幂等种子

前端：
- 修改 `src/layouts/defaultProps.tsx` — 菜单项
- 修改 `src/layouts/index.tsx` — `pathToPageKey` 加 `/fbd`
- 修改 `src/pages/setting/roleManage.tsx` — `PAGE_LABEL_KEY` 加 `fbd`
- 新增 `src/pages/fbd/index.tsx` — 列表页 + 详情弹窗

---

## Task 1: 纯逻辑 `back/shared/fbd.ts`（状态机守卫 + 占位分发器）

**Files:**
- Create: `back/shared/fbd.ts`
- Test: `back/shared/fbd.test.ts`

- [ ] **Step 1: 写失败的测试**

Create `back/shared/fbd.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert';
import {
  FbdTaskStatus,
  FBD_STATUS_LABEL,
  assertApprovable,
  applyUpdate,
} from './fbd';

test('五状态枚举值固定为 0..4', () => {
  assert.strictEqual(FbdTaskStatus.pending, 0);
  assert.strictEqual(FbdTaskStatus.approving, 1);
  assert.strictEqual(FbdTaskStatus.done, 2);
  assert.strictEqual(FbdTaskStatus.failed, 3);
  assert.strictEqual(FbdTaskStatus.rejected, 4);
});

test('每个状态都有中文标签', () => {
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.pending], '待审批');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.approving], '执行中');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.done], '已通过');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.failed], '失败');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.rejected], '已拒绝');
});

test('assertApprovable 仅放行 pending，其它状态抛错', () => {
  assert.doesNotThrow(() => assertApprovable(FbdTaskStatus.pending));
  assert.throws(() => assertApprovable(FbdTaskStatus.done), /非待审批/);
  assert.throws(() => assertApprovable(FbdTaskStatus.rejected), /非待审批/);
  assert.throws(() => assertApprovable(FbdTaskStatus.approving), /非待审批/);
});

test('applyUpdate fedex_rate 返回成功摘要', async () => {
  const r = await applyUpdate('fedex_rate', {});
  assert.match(r, /fedex_rate/);
});

test('applyUpdate 未知类型抛错', async () => {
  await assert.rejects(() => applyUpdate('unknown', {}), /未知任务类型/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbd.test.ts
```
Expected: FAIL，报 `Cannot find module './fbd'`（实现文件还没建）

- [ ] **Step 3: 写最小实现**

Create `back/shared/fbd.ts`:
```ts
export enum FbdTaskStatus {
  pending,   // 0 待审批
  approving, // 1 执行中
  done,      // 2 已通过
  failed,    // 3 失败
  rejected,  // 4 已拒绝
}

export const FBD_STATUS_LABEL: Record<FbdTaskStatus, string> = {
  [FbdTaskStatus.pending]: '待审批',
  [FbdTaskStatus.approving]: '执行中',
  [FbdTaskStatus.done]: '已通过',
  [FbdTaskStatus.failed]: '失败',
  [FbdTaskStatus.rejected]: '已拒绝',
};

// 仅 pending 可审批/拒绝；否则抛错（approve、reject 共用）
export function assertApprovable(status: FbdTaskStatus): void {
  if (status !== FbdTaskStatus.pending) {
    throw new Error('非待审批状态，不可审批');
  }
}

// TODO[fbd]: 接真正写 prd 数据库的逻辑。当前为占位框架。
// 返回值会写入 FbdTask.result；抛错则任务置为 failed。
export async function applyUpdate(type: string, payload: any): Promise<string> {
  switch (type) {
    case 'fedex_rate':
      // TODO: 调用 prd 数据库更新 API / 直连写表
      return 'fedex_rate 占位：已模拟更新成功（未真正写 prd）';
    default:
      throw new Error(`未知任务类型: ${type}`);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbd.test.ts
```
Expected: PASS（5 tests pass）

- [ ] **Step 5: 提交**

```bash
git add back/shared/fbd.ts back/shared/fbd.test.ts
git commit -m "feat(fbd): FBD 任务状态枚举/守卫/占位分发器 + 单测"
```

---

## Task 2: RBAC 接线 `back/shared/pageKeys.ts`

**Files:**
- Modify: `back/shared/pageKeys.ts`
- Test: `back/shared/pageKeys.test.ts`

- [ ] **Step 1: 改测试，增加 fbd 断言（先失败）**

在 `back/shared/pageKeys.test.ts` 中：

把「PAGE_KEYS 覆盖 9 个页面」这条测试整体替换为：
```ts
test('PAGE_KEYS 覆盖 10 个页面（含 fbd）', () => {
  assert.deepStrictEqual([...PAGE_KEYS], [
    'dashboard', 'crons', 'subscriptions', 'envs',
    'configs', 'scripts', 'dependencies', 'logs', 'settings', 'fbd',
  ]);
});
```

在文件末尾追加：
```ts
test('resolvePageKey 把 /api/fbd 映射到 fbd', () => {
  assert.strictEqual(resolvePageKey('/api/fbd'), 'fbd');
  assert.strictEqual(resolvePageKey('/api/fbd/tasks'), 'fbd');
  assert.strictEqual(resolvePageKey('/api/fbd/tasks/5'), 'fbd');
});

test('isAdminOnlyPath：fbd 审批/拒绝端点要求 Admin，列表不要求', () => {
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks/5/approve'), true);
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks/5/reject'), true);
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks'), false);
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks/5'), false);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/pageKeys.test.ts
```
Expected: FAIL（PAGE_KEYS 无 fbd、resolvePageKey 返回 null、isAdminOnlyPath 对 approve 返回 false）

- [ ] **Step 3: 改实现**

在 `back/shared/pageKeys.ts`：

`PAGE_KEYS` 末尾加 `'fbd'`：
```ts
export const PAGE_KEYS = [
  'dashboard', 'crons', 'subscriptions', 'envs',
  'configs', 'scripts', 'dependencies', 'logs', 'settings', 'fbd',
] as const;
```

`PREFIX_MAP` 末尾加一项：
```ts
const PREFIX_MAP: Array<[string, PageKey]> = [
  ['/api/dashboard', 'dashboard'],
  ['/api/crons', 'crons'],
  ['/api/subscriptions', 'subscriptions'],
  ['/api/envs', 'envs'],
  ['/api/configs', 'configs'],
  ['/api/scripts', 'scripts'],
  ['/api/dependencies', 'dependencies'],
  ['/api/logs', 'logs'],
  ['/api/system', 'settings'],
  ['/api/fbd', 'fbd'],
];
```

把 `isAdminOnlyPath` 整个替换为：
```ts
// 用户/角色管理端点 + FBD 审批/拒绝端点：额外要求 Admin
export function isAdminOnlyPath(path: string): boolean {
  const p = path.toLowerCase();
  if (['/api/users', '/api/roles'].some((x) => p === x || p.startsWith(x + '/'))) {
    return true;
  }
  // FBD 中心：审批/拒绝端点仅 Admin（列表/详情/新建/删除走 fbd pageKey）
  if (
    p.startsWith('/api/fbd/tasks/') &&
    (p.endsWith('/approve') || p.endsWith('/reject'))
  ) {
    return true;
  }
  return false;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/pageKeys.test.ts
```
Expected: PASS（全部通过）

- [ ] **Step 5: 提交**

```bash
git add back/shared/pageKeys.ts back/shared/pageKeys.test.ts
git commit -m "feat(fbd): RBAC 注册 fbd pageKey 与审批端点 Admin-only"
```

---

## Task 3: 数据模型 `back/data/fbdTask.ts` + db 同步与种子

**Files:**
- Create: `back/data/fbdTask.ts`
- Modify: `back/loaders/db.ts`

- [ ] **Step 1: 写模型**

Create `back/data/fbdTask.ts`:
```ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '.';
import { FbdTaskStatus } from '../shared/fbd';

export class FbdTask {
  id?: number;
  title?: string;
  type?: string;
  source?: string;
  payload?: any;
  status?: FbdTaskStatus;
  result?: string;
  operator?: string;
  timestamp?: string;

  constructor(options: FbdTask) {
    this.id = options.id;
    this.title = options.title;
    this.type = options.type;
    this.source = options.source || 'manual';
    this.payload = options.payload ?? {};
    this.status =
      typeof options.status === 'number'
        ? options.status
        : FbdTaskStatus.pending;
    this.result = options.result || '';
    this.operator = options.operator || '';
    this.timestamp = options.timestamp || new Date().toString();
  }
}

export interface FbdTaskInstance extends Model<FbdTask, FbdTask>, FbdTask {}

export const FbdTaskModel = sequelize.define<FbdTaskInstance>('FbdTask', {
  title: DataTypes.STRING,
  type: DataTypes.STRING,
  source: DataTypes.STRING,
  payload: DataTypes.JSON,
  status: DataTypes.NUMBER,
  result: DataTypes.TEXT,
  operator: DataTypes.STRING,
  timestamp: DataTypes.STRING,
});
```

- [ ] **Step 2: 在 db loader 注册 sync + 幂等种子**

在 `back/loaders/db.ts`：

文件顶部 import 区加：
```ts
import { FbdTaskModel } from '../data/fbdTask';
```

在 `await RolePermissionModel.sync();` 之后加一行：
```ts
    await FbdTaskModel.sync();
```

在 `const seedRbac = ...; await seedRbac();` 之前，插入种子逻辑：
```ts
    // FBD 中心：表为空时种子一条 fedex rate 示例
    const fbdCount = await FbdTaskModel.count();
    if (fbdCount === 0) {
      await FbdTaskModel.create({
        title: 'FedEx Rate 更新（示例）',
        type: 'fedex_rate',
        source: 'manual',
        payload: { note: '示例待审批数据，approve 后走占位更新', rates: {} },
        status: 0,
        result: '',
        operator: '',
        timestamp: new Date().toString(),
      } as any);
    }
```

- [ ] **Step 3: 编译后端，确认通过**

Run: `npm run build:back`
Expected: 编译成功，无 TS 报错。

- [ ] **Step 4: 提交**

```bash
git add back/data/fbdTask.ts back/loaders/db.ts
git commit -m "feat(fbd): FbdTask 模型 + db 同步与种子示例"
```

---

## Task 4: 业务 Service `back/services/fbd.ts`

**Files:**
- Create: `back/services/fbd.ts`

- [ ] **Step 1: 写 Service**

Create `back/services/fbd.ts`:
```ts
import { FindOptions, Op } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { FbdTask, FbdTaskModel } from '../data/fbdTask';
import { FbdTaskStatus, assertApprovable, applyUpdate } from '../shared/fbd';

@Service()
export default class FbdService {
  constructor(@Inject('logger') private logger: winston.Logger) {}

  public async list(params: {
    searchValue?: string;
    status?: number;
    page?: number;
    size?: number;
  }): Promise<{ data: FbdTask[]; total: number }> {
    const where: any = {};
    if (params.searchValue) {
      where.title = { [Op.like]: `%${params.searchValue}%` };
    }
    if (typeof params.status === 'number' && !Number.isNaN(params.status)) {
      where.status = params.status;
    }
    const page = params.page && params.page > 0 ? params.page : 1;
    const size = params.size && params.size > 0 ? params.size : 20;
    const options: FindOptions = {
      where,
      order: [['timestamp', 'DESC']],
      offset: (page - 1) * size,
      limit: size,
    };
    const result = await FbdTaskModel.findAndCountAll(options);
    return { data: result.rows, total: result.count };
  }

  public async get(id: number): Promise<FbdTask | null> {
    return FbdTaskModel.findByPk(id);
  }

  public async create(payload: FbdTask): Promise<FbdTask> {
    const tab = new FbdTask(payload);
    return FbdTaskModel.create(tab, { returning: true });
  }

  public async approve(id: number, operator: string): Promise<FbdTask> {
    const doc = await FbdTaskModel.findByPk(id);
    if (!doc) throw new Error('任务不存在');
    assertApprovable(doc.status as FbdTaskStatus);
    await doc.update({ status: FbdTaskStatus.approving, operator });
    try {
      const result = await applyUpdate(doc.type as string, doc.payload);
      await doc.update({ status: FbdTaskStatus.done, result });
      this.logger.info('[fbd] approve done id=%s by=%s', id, operator);
    } catch (e: any) {
      const msg = e?.message || String(e);
      await doc.update({ status: FbdTaskStatus.failed, result: msg });
      this.logger.error('[fbd] approve failed id=%s err=%s', id, msg);
    }
    return doc;
  }

  public async reject(id: number, operator: string): Promise<FbdTask> {
    const doc = await FbdTaskModel.findByPk(id);
    if (!doc) throw new Error('任务不存在');
    assertApprovable(doc.status as FbdTaskStatus);
    await doc.update({
      status: FbdTaskStatus.rejected,
      operator,
      result: '已拒绝',
    });
    this.logger.info('[fbd] reject id=%s by=%s', id, operator);
    return doc;
  }

  public async remove(ids: number[]): Promise<void> {
    await FbdTaskModel.destroy({ where: { id: ids } });
  }
}
```

- [ ] **Step 2: 编译后端，确认通过**

Run: `npm run build:back`
Expected: 编译成功，无 TS 报错。

- [ ] **Step 3: 提交**

```bash
git add back/services/fbd.ts
git commit -m "feat(fbd): FbdService 列表/详情/新建/审批/拒绝/删除"
```

---

## Task 5: REST 路由 `back/api/fbd.ts` + 注册

**Files:**
- Create: `back/api/fbd.ts`
- Modify: `back/api/index.ts`

- [ ] **Step 1: 写路由**

Create `back/api/fbd.ts`:
```ts
import { Joi, celebrate } from 'celebrate';
import { NextFunction, Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import FbdService from '../services/fbd';
import RbacService from '../services/rbac';

const route = Router();

async function currentUsername(req: Request): Promise<string> {
  const userId = (req as any).auth?.userId as number | undefined;
  if (!userId) return 'unknown';
  const rbac = Container.get(RbacService);
  const user = await rbac.findUserById(userId);
  return user?.username || 'unknown';
}

export default (app: Router) => {
  app.use('/fbd', route);

  route.get(
    '/tasks',
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        const fbdService = Container.get(FbdService);
        const data = await fbdService.list({
          searchValue: req.query.searchValue as string,
          status:
            req.query.status !== undefined && req.query.status !== ''
              ? Number(req.query.status)
              : undefined,
          page: req.query.page ? Number(req.query.page) : undefined,
          size: req.query.size ? Number(req.query.size) : undefined,
        });
        return res.send({ code: 200, data });
      } catch (e) {
        logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  route.get(
    '/tasks/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const data = await fbdService.get(Number(req.params.id));
        return res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.post(
    '/tasks',
    celebrate({
      body: Joi.object({
        title: Joi.string().required(),
        type: Joi.string().required(),
        source: Joi.string().optional().allow(''),
        payload: Joi.any().optional(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const data = await fbdService.create(req.body);
        return res.send({ code: 200, data });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.put(
    '/tasks/:id/approve',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const operator = await currentUsername(req);
        const data = await fbdService.approve(Number(req.params.id), operator);
        return res.send({ code: 200, data });
      } catch (e: any) {
        return res.send({ code: 400, message: e?.message || String(e) });
      }
    },
  );

  route.put(
    '/tasks/:id/reject',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        const operator = await currentUsername(req);
        const data = await fbdService.reject(Number(req.params.id), operator);
        return res.send({ code: 200, data });
      } catch (e: any) {
        return res.send({ code: 400, message: e?.message || String(e) });
      }
    },
  );

  route.delete(
    '/tasks',
    celebrate({ body: Joi.array().items(Joi.number().required()) }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fbdService = Container.get(FbdService);
        await fbdService.remove(req.body);
        return res.send({ code: 200 });
      } catch (e) {
        return next(e);
      }
    },
  );
};
```

- [ ] **Step 2: 在 `back/api/index.ts` 注册**

在 import 区加：
```ts
import fbd from './fbd';
```
在 `roles(app);` 之后加：
```ts
  fbd(app);
```

- [ ] **Step 3: 编译后端，确认通过**

Run: `npm run build:back`
Expected: 编译成功，无 TS 报错。

- [ ] **Step 4: 提交**

```bash
git add back/api/fbd.ts back/api/index.ts
git commit -m "feat(fbd): /api/fbd 路由（列表/详情/新建/审批/拒绝/删除）"
```

---

## Task 6: 前端菜单 + RBAC 接线

**Files:**
- Modify: `src/layouts/defaultProps.tsx`
- Modify: `src/layouts/index.tsx`
- Modify: `src/pages/setting/roleManage.tsx`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

> 注意：菜单名走 `intl.get('FBD 中心')`，必须在两个 locale 文件里登记，否则菜单名显示为空。

- [ ] **Step 1: 加菜单项**

在 `src/layouts/defaultProps.tsx` 中，`/crontab` 那一项之后、`/subscription` 之前插入：
```tsx
      {
        path: '/fbd',
        name: intl.get('FBD 中心'),
        icon: <IconFont type="ql-icon-crontab" />,
        component: '@/pages/fbd/index',
      },
```

- [ ] **Step 2: 菜单 RBAC 过滤接线**

在 `src/layouts/index.tsx` 的 `pathToPageKey` 对象中（`'/crontab': 'crons',` 之后）加：
```ts
          '/fbd': 'fbd',
```

- [ ] **Step 3: 角色编辑页 label**

在 `src/pages/setting/roleManage.tsx` 的 `PAGE_LABEL_KEY` 对象中（`crons: '定时任务',` 之后）加：
```ts
  fbd: 'FBD 中心',
```

- [ ] **Step 4: 登记 locale 键**

在 `src/locales/zh-CN.json` 的 `"定时任务": "定时任务",` 这一行之后加：
```json
  "FBD 中心": "FBD 中心",
```

在 `src/locales/en-US.json` 的 `"定时任务": "Scheduled Tasks",` 这一行之后加：
```json
  "FBD 中心": "FBD Center",
```

- [ ] **Step 5: 提交**

```bash
git add src/layouts/defaultProps.tsx src/layouts/index.tsx src/pages/setting/roleManage.tsx src/locales/zh-CN.json src/locales/en-US.json
git commit -m "feat(fbd): 前端菜单 FBD 中心 + RBAC 菜单/角色接线 + locale"
```

---

## Task 7: 前端页面 `src/pages/fbd/index.tsx`

**Files:**
- Create: `src/pages/fbd/index.tsx`

- [ ] **Step 1: 写页面**

Create `src/pages/fbd/index.tsx`:
```tsx
import { SharedContext } from '@/layouts';
import config from '@/utils/config';
import { request } from '@/utils/http';
import { PageContainer } from '@ant-design/pro-layout';
import { useOutletContext } from '@umijs/max';
import {
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { ColumnProps } from 'antd/lib/table';
import React, { useEffect, useState } from 'react';

const STATUS_LABEL: Record<number, string> = {
  0: '待审批',
  1: '执行中',
  2: '已通过',
  3: '失败',
  4: '已拒绝',
};
const STATUS_COLOR: Record<number, string> = {
  0: 'orange',
  1: 'blue',
  2: 'green',
  3: 'red',
  4: 'default',
};

const FbdCenter = () => {
  const { headerStyle, user } = useOutletContext<SharedContext>();
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [detail, setDetail] = useState<any>(null);
  const isAdmin = !!user?.isAdmin;

  const getList = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchText) params.set('searchValue', searchText);
    if (statusFilter !== undefined) params.set('status', String(statusFilter));
    params.set('page', String(page));
    params.set('size', String(size));
    request
      .get(`${config.apiPrefix}fbd/tasks?${params.toString()}`)
      .then(({ code, data }) => {
        if (code === 200) {
          setData(data.data);
          setTotal(data.total);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    getList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, statusFilter]);

  const handleApprove = (record: any) => {
    request
      .put(`${config.apiPrefix}fbd/tasks/${record.id}/approve`)
      .then(({ code, message: msg }) => {
        if (code === 200) {
          message.success('已审批');
          getList();
        } else {
          message.error(msg || '审批失败');
        }
      });
  };

  const handleReject = (record: any) => {
    request
      .put(`${config.apiPrefix}fbd/tasks/${record.id}/reject`)
      .then(({ code, message: msg }) => {
        if (code === 200) {
          message.success('已拒绝');
          getList();
        } else {
          message.error(msg || '操作失败');
        }
      });
  };

  const columns: ColumnProps<any>[] = [
    { title: '名称', dataIndex: 'title', key: 'title' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '来源', dataIndex: 'source', key: 'source' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: number) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>,
    },
    { title: '创建时间', dataIndex: 'timestamp', key: 'timestamp' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <a onClick={() => setDetail(record)}>查看</a>
          {isAdmin && record.status === 0 && (
            <Popconfirm
              title="确认通过并执行更新？"
              onConfirm={() => handleApprove(record)}
            >
              <a>通过</a>
            </Popconfirm>
          )}
          {isAdmin && record.status === 0 && (
            <Popconfirm title="确认拒绝？" onConfirm={() => handleReject(record)}>
              <a style={{ color: '#ff4d4f' }}>拒绝</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      className="ql-container-wrapper"
      title="FBD 中心"
      header={{ style: headerStyle }}
      extra={[
        <Select
          key="status"
          allowClear
          placeholder="状态筛选"
          style={{ width: 120 }}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={Object.keys(STATUS_LABEL).map((k) => ({
            value: Number(k),
            label: STATUS_LABEL[Number(k)],
          }))}
        />,
        <Input.Search
          key="search"
          placeholder="请输入名称或者关键词"
          style={{ width: 220 }}
          onSearch={() => {
            setPage(1);
            getList();
          }}
          onChange={(e) => setSearchText(e.target.value)}
        />,
      ]}
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          current: page,
          pageSize: size,
          total,
          onChange: (p, s) => {
            setPage(p);
            setSize(s);
          },
        }}
      />
      <Modal
        open={!!detail}
        title={detail?.title}
        footer={null}
        onCancel={() => setDetail(null)}
        width={640}
      >
        {detail && (
          <div>
            <p>类型：{detail.type}</p>
            <p>来源：{detail.source}</p>
            <p>状态：{STATUS_LABEL[detail.status]}</p>
            <p>操作人：{detail.operator || '-'}</p>
            <p>执行结果：{detail.result || '-'}</p>
            <p>数据 payload：</p>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                maxHeight: 360,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(detail.payload, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default FbdCenter;
```

- [ ] **Step 2: 前端启动并人工验证**

Run: `npm run start:front`（或整体 `npm start`，后端需同时运行）
验证：
1. 用 Admin 登录，侧边栏「定时任务」下出现「FBD 中心」，点开看到列表里有种子的「FedEx Rate 更新（示例）」，状态「待审批」。
2. 点「查看」，弹窗展示 payload（格式化 JSON）。
3. 点「通过」→ Popconfirm 确认 → 列表刷新，状态变「已通过」，查看详情 result 为占位成功文案。
4. 用非 Admin 角色（已在角色管理勾选 FBD 中心页面）登录，能看到菜单和列表，但「通过/拒绝」按钮不显示。

Expected: 上述行为全部符合。

- [ ] **Step 3: 提交**

```bash
git add src/pages/fbd/index.tsx
git commit -m "feat(fbd): FBD 中心列表页 + 详情弹窗 + 审批/拒绝"
```

---

## 收尾验证

- [ ] 运行全部 shared 单测：
```bash
TS_NODE_PROJECT=back/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test back/shared/fbd.test.ts back/shared/pageKeys.test.ts
```
Expected: 全部 PASS

- [ ] `npm run build:back` 编译通过

- [ ] 按 Task 7 Step 2 的人工验证清单走一遍 Admin / 非 Admin 两条路径

## 后续（不在本期范围）

- 改造 `fedex_*.py`：跑完后用 open API token `POST /api/fbd/tasks` push 真实待审批数据
- 在 `applyUpdate` 的 `fedex_rate` 分支接真正写 prd 数据库的逻辑
- 失败条目的「重新审批/重试」
