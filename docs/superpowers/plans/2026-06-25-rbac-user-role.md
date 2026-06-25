# RBAC User/Role 权限系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 JobCenter（qinglong 源码）增加简单的多用户 + 角色 + 页面级权限系统，统一登录改造，对标 `../rma` 的 `User/Role/UserRole/RolePermission(PageKey)` 模型。

**Architecture:** 4 张 Sequelize 表存入现有 `database.sqlite`；登录改查 `Users` 表（bcrypt），JWT 携带 `userId`；`/api/*` 中间件按路径→pageKey 实时查库鉴权，Admin 角色通杀；用户/角色管理 API + 前端 Tab；首次启动把现有单管理员幂等迁移为第一个 Admin 用户。从源码用 qinglong 自带 Dockerfile 构建镜像。

**Tech Stack:** Node + TypeScript、Express、Sequelize(SQLite)、typedi DI、celebrate(Joi) 校验、bcryptjs、jsonwebtoken、@otplib(2FA 复用)；前端 umi + React + antd；测试 `umi-test`(jest)；Docker 多阶段构建。

**参考代码**（实现时先读）：
- 模型模式：`back/data/env.ts`
- API 模式 + DI：`back/api/env.ts`
- 登录现状：`back/services/user.ts`（`login`/`getAuthInfo`）
- 鉴权现状：`back/loaders/express.ts`（40–140 行自定义 `/api/*` 中间件）、`back/shared/auth.ts`（`isValidToken`）、`back/config/util.ts`（`getToken`）
- 建表/迁移钩子：`back/loaders/db.ts`
- RMA 参照：`../rma/rma-system/backend/RmaSystem.Core/Entities/{User,Role,UserRole,RolePermission}.cs`、`../rma/.../Authorization/PagePermissionHandler.cs`

**Spec:** `docs/superpowers/specs/2026-06-25-rbac-user-role-design.md`

---

## 文件结构

**新增（后端）**
- `back/data/user.ts` — User 模型 + TS 接口
- `back/data/role.ts` — Role 模型
- `back/data/userRole.ts` — UserRole 连接表模型
- `back/data/rolePermission.ts` — RolePermission 模型
- `back/shared/pageKeys.ts` — PageKey 全集常量 + 路径→pageKey 映射 + 纯函数（**纯逻辑，单测**）
- `back/services/rbac.ts` — RBAC 业务（用户/角色 CRUD、权限解析、护栏）
- `back/services/auth-seed.ts` — 幂等迁移/初始化
- `back/api/users.ts` — 用户管理路由
- `back/api/roles.ts` — 角色管理路由
- `back/shared/pageKeys.test.ts` — 纯逻辑单测

**修改（后端）**
- `back/data/index.ts` — 无需改（模型各自 import sequelize）
- `back/loaders/db.ts` — sync 新模型 + 调用 seed
- `back/loaders/express.ts` — 鉴权中间件按 pageKey 拦截
- `back/services/user.ts` — 登录改查 Users 表 + JWT 带 userId
- `back/api/user.ts` — `GET /api/user` 返回 pageKey、自助改密
- `back/api/index.ts` — 挂载 users/roles 路由
- `package.json` — 加 `bcryptjs`、`@types/bcryptjs`

**新增/修改（前端）**
- `src/pages/setting/userManage.tsx` — 用户管理 Tab
- `src/pages/setting/roleManage.tsx` — 角色管理 Tab
- `src/pages/setting/index.tsx` — 挂两个 Tab（仅 Admin）
- `src/layouts/index.tsx` — 菜单按 pageKey 过滤 + 当前用户
- `src/locales/*` — 品牌名 i18n（FBD Center）

**部署**
- `docker/docker-compose.yml` — build 指向主 `docker/Dockerfile`
- `docker/Dockerfile.fbd` — 删除（退役）

---

## Phase 1：权限纯逻辑（PageKey）—— TDD

### Task 1: PageKey 常量、路径映射与纯函数

**Files:**
- Create: `back/shared/pageKeys.ts`
- Test: `back/shared/pageKeys.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// back/shared/pageKeys.test.ts
import {
  PAGE_KEYS,
  resolvePageKey,
  isAdminOnlyPath,
  computeEffectivePages,
} from './pageKeys';

describe('pageKeys', () => {
  it('PAGE_KEYS 覆盖 9 个页面', () => {
    expect(PAGE_KEYS).toEqual([
      'dashboard', 'crons', 'subscriptions', 'envs',
      'configs', 'scripts', 'dependencies', 'logs', 'settings',
    ]);
  });

  it('resolvePageKey 把 API 路径映射到 pageKey', () => {
    expect(resolvePageKey('/api/crons')).toBe('crons');
    expect(resolvePageKey('/api/crons/123/run')).toBe('crons');
    expect(resolvePageKey('/api/envs')).toBe('envs');
    expect(resolvePageKey('/api/system/config')).toBe('settings');
    expect(resolvePageKey('/api/dashboard')).toBe('dashboard');
  });

  it('未知路径返回 null（默认不放行）', () => {
    expect(resolvePageKey('/api/whatever')).toBeNull();
  });

  it('isAdminOnlyPath 命中 users/roles', () => {
    expect(isAdminOnlyPath('/api/users')).toBe(true);
    expect(isAdminOnlyPath('/api/roles/abc')).toBe(true);
    expect(isAdminOnlyPath('/api/crons')).toBe(false);
  });

  it('computeEffectivePages 求角色 pageKey 并集去重', () => {
    expect(
      computeEffectivePages([['dashboard', 'crons'], ['crons', 'logs']]),
    ).toEqual(['dashboard', 'crons', 'logs']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx umi-test back/shared/pageKeys.test.ts`
Expected: FAIL（`Cannot find module './pageKeys'`）

- [ ] **Step 3: 写实现**

```ts
// back/shared/pageKeys.ts
export const PAGE_KEYS = [
  'dashboard', 'crons', 'subscriptions', 'envs',
  'configs', 'scripts', 'dependencies', 'logs', 'settings',
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

// API 路径前缀 → pageKey（顺序无关，取最长匹配前缀）
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
];

export function resolvePageKey(path: string): PageKey | null {
  const p = path.toLowerCase();
  let matched: PageKey | null = null;
  let matchedLen = -1;
  for (const [prefix, key] of PREFIX_MAP) {
    if ((p === prefix || p.startsWith(prefix + '/')) && prefix.length > matchedLen) {
      matched = key;
      matchedLen = prefix.length;
    }
  }
  return matched;
}

// 用户/角色管理端点：额外要求 Admin
export function isAdminOnlyPath(path: string): boolean {
  const p = path.toLowerCase();
  return ['/api/users', '/api/roles'].some(
    (x) => p === x || p.startsWith(x + '/'),
  );
}

export function computeEffectivePages(rolePages: string[][]): string[] {
  const set = new Set<string>();
  for (const pages of rolePages) for (const k of pages) set.add(k);
  return Array.from(set);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx umi-test back/shared/pageKeys.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add back/shared/pageKeys.ts back/shared/pageKeys.test.ts
git commit -m "feat(rbac): pageKey 常量、路径映射与权限并集纯函数"
```

---

## Phase 2：数据模型

> 模式严格照 `back/data/env.ts`：`class` + TS 接口 + `sequelize.define`。无独立单测（建表由后续冒烟覆盖）。每个模型建完即提交。

### Task 2: User 模型

**Files:**
- Create: `back/data/user.ts`

- [ ] **Step 1: 写模型**

```ts
// back/data/user.ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '.';

export class User {
  id?: number;
  username?: string;
  passwordHash?: string;
  nickname?: string;
  email?: string;
  isActive?: 1 | 0;
  twoFactorSecret?: string;
  twoFactorActivated?: 1 | 0;
  lastLoginAt?: string;

  constructor(options: User) {
    this.id = options.id;
    this.username = options.username;
    this.passwordHash = options.passwordHash;
    this.nickname = options.nickname || options.username;
    this.email = options.email || '';
    this.isActive = options.isActive ?? 1;
    this.twoFactorSecret = options.twoFactorSecret || '';
    this.twoFactorActivated = options.twoFactorActivated || 0;
    this.lastLoginAt = options.lastLoginAt;
  }
}

export interface UserInstance extends Model<User, User>, User {}
export const UserModel = sequelize.define<UserInstance>('User', {
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  nickname: DataTypes.STRING,
  email: DataTypes.STRING,
  isActive: DataTypes.NUMBER,
  twoFactorSecret: DataTypes.STRING,
  twoFactorActivated: DataTypes.NUMBER,
  lastLoginAt: DataTypes.STRING,
});
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error（与本文件相关）

- [ ] **Step 3: 提交**

```bash
git add back/data/user.ts
git commit -m "feat(rbac): User 模型"
```

### Task 3: Role 模型

**Files:**
- Create: `back/data/role.ts`

- [ ] **Step 1: 写模型**

```ts
// back/data/role.ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '.';

export class Role {
  id?: number;
  name?: string;
  description?: string;
  isBuiltin?: 1 | 0;

  constructor(options: Role) {
    this.id = options.id;
    this.name = options.name;
    this.description = options.description || '';
    this.isBuiltin = options.isBuiltin || 0;
  }
}

export interface RoleInstance extends Model<Role, Role>, Role {}
export const RoleModel = sequelize.define<RoleInstance>('Role', {
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: DataTypes.STRING,
  isBuiltin: DataTypes.NUMBER,
});
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 3: 提交**

```bash
git add back/data/role.ts
git commit -m "feat(rbac): Role 模型"
```

### Task 4: UserRole 与 RolePermission 模型

**Files:**
- Create: `back/data/userRole.ts`
- Create: `back/data/rolePermission.ts`

- [ ] **Step 1: 写 UserRole**

```ts
// back/data/userRole.ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '.';

export class UserRole {
  id?: number;
  userId?: number;
  roleId?: number;
  constructor(options: UserRole) {
    this.id = options.id;
    this.userId = options.userId;
    this.roleId = options.roleId;
  }
}

export interface UserRoleInstance extends Model<UserRole, UserRole>, UserRole {}
export const UserRoleModel = sequelize.define<UserRoleInstance>('UserRole', {
  userId: { type: DataTypes.NUMBER, allowNull: false },
  roleId: { type: DataTypes.NUMBER, allowNull: false },
});
```

- [ ] **Step 2: 写 RolePermission**

```ts
// back/data/rolePermission.ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '.';

export class RolePermission {
  id?: number;
  roleId?: number;
  pageKey?: string;
  constructor(options: RolePermission) {
    this.id = options.id;
    this.roleId = options.roleId;
    this.pageKey = options.pageKey;
  }
}

export interface RolePermissionInstance
  extends Model<RolePermission, RolePermission>, RolePermission {}
export const RolePermissionModel = sequelize.define<RolePermissionInstance>(
  'RolePermission',
  {
    roleId: { type: DataTypes.NUMBER, allowNull: false },
    pageKey: { type: DataTypes.STRING, allowNull: false },
  },
);
```

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 4: 提交**

```bash
git add back/data/userRole.ts back/data/rolePermission.ts
git commit -m "feat(rbac): UserRole 与 RolePermission 模型"
```

### Task 5: 在 db.ts 同步新模型

**Files:**
- Modify: `back/loaders/db.ts`

- [ ] **Step 1: 加 import 与 sync**

在 `back/loaders/db.ts` 顶部 import 段加：

```ts
import { UserModel } from '../data/user';
import { RoleModel } from '../data/role';
import { UserRoleModel } from '../data/userRole';
import { RolePermissionModel } from '../data/rolePermission';
```

在现有 `await RunningInstanceModel.sync();` 之后加：

```ts
    await UserModel.sync();
    await RoleModel.sync();
    await UserRoleModel.sync();
    await RolePermissionModel.sync();
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 3: 提交**

```bash
git add back/loaders/db.ts
git commit -m "feat(rbac): 启动时同步 4 张 RBAC 表"
```

---

## Phase 3：RBAC 服务（权限解析 + 护栏纯逻辑）—— 部分 TDD

### Task 6: 护栏纯函数（防自锁/删最后 Admin）

**Files:**
- Modify: `back/shared/pageKeys.ts`（追加护栏纯函数，便于单测）
- Modify: `back/shared/pageKeys.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 back/shared/pageKeys.test.ts
import { assertNotLastAdmin } from './pageKeys';

describe('guards', () => {
  it('删/停最后一个 Admin 抛错', () => {
    expect(() => assertNotLastAdmin(1, 'delete')).toThrow();
    expect(() => assertNotLastAdmin(0, 'disable')).toThrow();
  });
  it('还有其他 Admin 时放行', () => {
    expect(() => assertNotLastAdmin(2, 'delete')).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx umi-test back/shared/pageKeys.test.ts`
Expected: FAIL（`assertNotLastAdmin is not a function`）

- [ ] **Step 3: 追加实现**

```ts
// 追加到 back/shared/pageKeys.ts
// remainingAdminCount = 执行该操作后剩余的有效 Admin 数
export function assertNotLastAdmin(
  remainingAdminCount: number,
  action: 'delete' | 'disable' | 'demote',
): void {
  if (remainingAdminCount < 1) {
    throw new Error(`操作被拒绝：系统必须至少保留一个启用的 Admin（${action}）`);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx umi-test back/shared/pageKeys.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add back/shared/pageKeys.ts back/shared/pageKeys.test.ts
git commit -m "feat(rbac): 最后一个 Admin 护栏纯函数"
```

### Task 7: RbacService（用户/角色 CRUD + 权限查询）

**Files:**
- Create: `back/services/rbac.ts`

> 无独立单测（依赖 DB + DI），由 Phase 8 冒烟覆盖。照 `back/services/env.ts`/`user.ts` 的 `@Service()` + `@Inject('logger')` 模式。

- [ ] **Step 1: 写服务**

```ts
// back/services/rbac.ts
import { Service, Inject } from 'typedi';
import winston from 'winston';
import bcrypt from 'bcryptjs';
import { UserModel, User } from '../data/user';
import { RoleModel } from '../data/role';
import { UserRoleModel } from '../data/userRole';
import { RolePermissionModel } from '../data/rolePermission';
import { computeEffectivePages, assertNotLastAdmin, PAGE_KEYS } from '../shared/pageKeys';

const ADMIN_ROLE = 'Admin';

@Service()
export default class RbacService {
  constructor(@Inject('logger') private logger: winston.Logger) {}

  private async roleIdsOfUser(userId: number): Promise<number[]> {
    const rows = await UserRoleModel.findAll({ where: { userId } });
    return rows.map((r) => r.roleId!);
  }

  public async isAdmin(userId: number): Promise<boolean> {
    const roleIds = await this.roleIdsOfUser(userId);
    if (!roleIds.length) return false;
    const admin = await RoleModel.findOne({ where: { name: ADMIN_ROLE } });
    return !!admin && roleIds.includes(admin.id!);
  }

  // 用户有效 pageKey 并集
  public async effectivePages(userId: number): Promise<string[]> {
    const roleIds = await this.roleIdsOfUser(userId);
    if (!roleIds.length) return [];
    const perms = await RolePermissionModel.findAll({ where: { roleId: roleIds } });
    const byRole: Record<number, string[]> = {};
    for (const p of perms) (byRole[p.roleId!] ||= []).push(p.pageKey!);
    return computeEffectivePages(Object.values(byRole));
  }

  public async findActiveUserByName(username: string) {
    return UserModel.findOne({ where: { username, isActive: 1 } });
  }

  public async findUserById(id: number) {
    return UserModel.findByPk(id);
  }

  // ---- 用户 CRUD ----
  public async listUsers() {
    const users = await UserModel.findAll();
    const result = [];
    for (const u of users) {
      const roleIds = await this.roleIdsOfUser(u.id!);
      result.push({
        id: u.id, username: u.username, nickname: u.nickname,
        email: u.email, isActive: u.isActive, lastLoginAt: u.lastLoginAt,
        roleIds,
      });
    }
    return result;
  }

  public async createUser(payload: {
    username: string; password: string; nickname?: string;
    email?: string; roleIds: number[];
  }) {
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const user = await UserModel.create(
      new User({ username: payload.username, passwordHash,
        nickname: payload.nickname, email: payload.email, isActive: 1 } as User),
    );
    await this.setUserRoles(user.id!, payload.roleIds);
    return user.id;
  }

  public async updateUser(id: number, payload: {
    nickname?: string; email?: string; isActive?: 1 | 0; roleIds?: number[];
  }) {
    // 禁用最后一个 Admin 护栏
    if (payload.isActive === 0 && (await this.isAdmin(id))) {
      assertNotLastAdmin(await this.otherActiveAdminCount(id), 'disable');
    }
    if (payload.roleIds && (await this.isAdmin(id)) &&
        !(await this.roleIdsAreAdmin(payload.roleIds))) {
      assertNotLastAdmin(await this.otherActiveAdminCount(id), 'demote');
    }
    await UserModel.update(
      { nickname: payload.nickname, email: payload.email, isActive: payload.isActive },
      { where: { id } },
    );
    if (payload.roleIds) await this.setUserRoles(id, payload.roleIds);
  }

  public async resetPassword(id: number, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    await UserModel.update({ passwordHash }, { where: { id } });
  }

  public async deleteUser(id: number) {
    if (await this.isAdmin(id)) {
      assertNotLastAdmin(await this.otherActiveAdminCount(id), 'delete');
    }
    await UserModel.destroy({ where: { id } });
    await UserRoleModel.destroy({ where: { userId: id } });
  }

  private async setUserRoles(userId: number, roleIds: number[]) {
    await UserRoleModel.destroy({ where: { userId } });
    for (const roleId of roleIds) await UserRoleModel.create({ userId, roleId } as any);
  }

  private async roleIdsAreAdmin(roleIds: number[]): Promise<boolean> {
    const admin = await RoleModel.findOne({ where: { name: ADMIN_ROLE } });
    return !!admin && roleIds.includes(admin.id!);
  }

  // 除该用户外、仍启用的 Admin 数
  private async otherActiveAdminCount(excludeUserId: number): Promise<number> {
    const admin = await RoleModel.findOne({ where: { name: ADMIN_ROLE } });
    if (!admin) return 0;
    const links = await UserRoleModel.findAll({ where: { roleId: admin.id } });
    let count = 0;
    for (const l of links) {
      if (l.userId === excludeUserId) continue;
      const u = await UserModel.findByPk(l.userId!);
      if (u && u.isActive === 1) count++;
    }
    return count;
  }

  // ---- 角色 CRUD ----
  public async listRoles() {
    const roles = await RoleModel.findAll();
    const result = [];
    for (const r of roles) {
      const perms = await RolePermissionModel.findAll({ where: { roleId: r.id } });
      result.push({
        id: r.id, name: r.name, description: r.description,
        isBuiltin: r.isBuiltin, pageKeys: perms.map((p) => p.pageKey),
      });
    }
    return result;
  }

  public async createRole(payload: { name: string; description?: string; pageKeys: string[] }) {
    const role = await RoleModel.create(
      { name: payload.name, description: payload.description || '', isBuiltin: 0 } as any,
    );
    await this.setRolePages(role.id!, payload.pageKeys);
    return role.id;
  }

  public async updateRole(id: number, payload: {
    name?: string; description?: string; pageKeys?: string[];
  }) {
    const role = await RoleModel.findByPk(id);
    if (!role) throw new Error('角色不存在');
    await RoleModel.update(
      { name: payload.name ?? role.name, description: payload.description ?? role.description },
      { where: { id } },
    );
    if (payload.pageKeys) await this.setRolePages(id, payload.pageKeys);
  }

  public async deleteRole(id: number) {
    const role = await RoleModel.findByPk(id);
    if (!role) return;
    if (role.isBuiltin === 1) throw new Error('内置角色不可删除');
    await RoleModel.destroy({ where: { id } });
    await RolePermissionModel.destroy({ where: { roleId: id } });
    await UserRoleModel.destroy({ where: { roleId: id } });
  }

  private async setRolePages(roleId: number, pageKeys: string[]) {
    const valid = pageKeys.filter((k) => (PAGE_KEYS as readonly string[]).includes(k));
    await RolePermissionModel.destroy({ where: { roleId } });
    for (const pageKey of valid) await RolePermissionModel.create({ roleId, pageKey } as any);
  }
}
```

- [ ] **Step 2: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 3: 提交**

```bash
git add back/services/rbac.ts
git commit -m "feat(rbac): RbacService 用户/角色 CRUD 与权限查询"
```

### Task 8: 加 bcryptjs 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装**

Run: `pnpm add bcryptjs && pnpm add -D @types/bcryptjs`
Expected: `package.json` 出现 `bcryptjs` 依赖

- [ ] **Step 2: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: 加 bcryptjs 用于密码哈希"
```

---

## Phase 4：幂等迁移 / 初始化

### Task 9: auth-seed（建内置角色 + 迁移现有管理员）

**Files:**
- Create: `back/services/auth-seed.ts`
- Modify: `back/loaders/db.ts`

> 复用 `UserService.getAuthInfo()` 读现有单管理员；照 `db.ts` 现有 try/catch 风格。无独立单测，由 Phase 8 冒烟验证（首启迁移 + 重启幂等）。

- [ ] **Step 1: 写 seed**

```ts
// back/services/auth-seed.ts
import bcrypt from 'bcryptjs';
import Logger from '../loaders/logger';
import { UserModel } from '../data/user';
import { RoleModel } from '../data/role';
import { UserRoleModel } from '../data/userRole';
import { RolePermissionModel } from '../data/rolePermission';
import { shareStore } from '../shared/store';

// 幂等：可重复调用
export default async function seedRbac() {
  try {
    // 1. 内置 Admin 角色
    let admin = await RoleModel.findOne({ where: { name: 'Admin' } });
    if (!admin) {
      admin = await RoleModel.create(
        { name: 'Admin', description: '超级管理员（通杀）', isBuiltin: 1 } as any,
      );
    }

    // 2. 示例 Viewer 角色 + 默认 pageKey
    let viewer = await RoleModel.findOne({ where: { name: 'Viewer' } });
    if (!viewer) {
      viewer = await RoleModel.create(
        { name: 'Viewer', description: '只读示例', isBuiltin: 0 } as any,
      );
      for (const pageKey of ['dashboard', 'crons', 'logs']) {
        await RolePermissionModel.create({ roleId: viewer.id, pageKey } as any);
      }
    }

    // 3. Users 空 → 迁移现有单管理员
    const count = await UserModel.count();
    if (count === 0) {
      const authInfo = (await shareStore.getAuthInfo()) || ({} as any);
      const username = authInfo.username || 'admin';
      const rawPassword = authInfo.password || 'admin';
      const passwordHash = await bcrypt.hash(rawPassword, 10);
      const user = await UserModel.create(
        {
          username,
          passwordHash,
          nickname: username,
          isActive: 1,
          twoFactorSecret: authInfo.twoFactorSecret || '',
          twoFactorActivated: authInfo.twoFactorActivated ? 1 : 0,
        } as any,
      );
      await UserRoleModel.create({ userId: user.id, roleId: admin.id } as any);
      Logger.info('✌️ RBAC: 已迁移现有管理员 [%s] 为首个 Admin 用户', username);
    }
    Logger.info('✌️ RBAC seed done');
  } catch (error) {
    Logger.error('✌️ RBAC seed failed', error);
  }
}
```

- [ ] **Step 2: 在 db.ts 末尾调用**

在 `back/loaders/db.ts` 的 `Logger.info('✌️ DB loaded');` **之前**加：

```ts
    const seedRbac = (await import('../services/auth-seed')).default;
    await seedRbac();
```

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 4: 提交**

```bash
git add back/services/auth-seed.ts back/loaders/db.ts
git commit -m "feat(rbac): 幂等 seed —— 内置角色 + 迁移现有管理员"
```

---

## Phase 5：登录改造

### Task 10: login 改查 Users 表 + JWT 带 userId

**Files:**
- Modify: `back/services/user.ts`

> 实现前先通读 `login` 全文（约 41–215 行）。保留：防爆破退避、登录日志、2FA(420)、令牌列表/平台绑定逻辑。只替换「凭据来源」与「JWT payload」。

- [ ] **Step 1: 改凭据校验**

在 `login` 中，把读取单管理员、明文比对的部分替换为查 `Users` 表 + bcrypt：

```ts
// 顶部 import 追加
import bcrypt from 'bcryptjs';
import RbacService from './rbac';
import { Container } from 'typedi';
import { UserModel } from '../data/user';

// login 内：原 const content = await this.getAuthInfo(); 仍保留用于 retries/日志聚合，
// 但凭据改为：
const userRow = await UserModel.findOne({ where: { username } });
if (!userRow || userRow.isActive !== 1) {
  // 走原失败分支（retries+1、记录日志、返回“用户名或密码错误”）
  // —— 复用现有失败处理代码块
}
const passwordOk = userRow
  ? await bcrypt.compare(password, userRow.passwordHash || '')
  : false;

// 原先所有 `username === cUsername && password === cPassword` 的条件
// 改为 `passwordOk`，且 twoFactor 状态从 userRow 读取：
const twoFactorActivated = userRow?.twoFactorActivated === 1;
```

- [ ] **Step 2: 改 JWT payload 带 userId**

把 `jwt.sign({ data }, ...)` 改为：

```ts
let token = jwt.sign({ data, userId: userRow!.id }, config.jwt.secret, {
  expiresIn: config.jwt.expiresIn || expiration,
  algorithm: 'HS384',
});
```

并在登录成功分支更新 `lastLoginAt`：

```ts
await UserModel.update({ lastLoginAt: String(timestamp) }, { where: { id: userRow!.id } });
```

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 4: 提交**

```bash
git add back/services/user.ts
git commit -m "feat(rbac): 登录改查 Users 表(bcrypt) 且 JWT 携带 userId"
```

---

## Phase 6：鉴权中间件

### Task 11: /api/* 按 pageKey 拦截

**Files:**
- Modify: `back/loaders/express.ts`

> 在现有自定义中间件（76 行起、处理 `/open/` 与 `/api/` token 校验那段）的**令牌校验通过之后**插入 pageKey 检查。JWT 校验仍由上方 `expressjwt` 完成；从 `req.auth`（express-jwt 解码结果）取 `userId`。

- [ ] **Step 1: 加 import 与 userId 提取**

顶部追加：

```ts
import { resolvePageKey, isAdminOnlyPath } from '../shared/pageKeys';
import RbacService from '../services/rbac';
import { Container } from 'typedi';
```

- [ ] **Step 2: 插入 pageKey 鉴权**

在自定义中间件中，`/api/` 分支确认 token 有效（现有 `isValidToken(...)` 通过）后、`return next()` 之前，插入：

```ts
// 仅对 /api/ 做 pageKey 鉴权（/open/ 走 App scope，不变）
if (pathLower.startsWith('/api/')) {
  const userId = (req as any).auth?.userId as number | undefined;
  if (!userId) {
    // 白名单端点（login/init 等）此处可能无 userId —— 已在 apiWhiteList 放行，
    // 走到这说明是受保护端点但无 userId → 拒绝
    return next(new UnauthorizedError('credentials_required',
      { message: 'No user in token' }));
  }
  const rbac = Container.get(RbacService);
  const user = await rbac.findUserById(userId);
  if (!user || user.isActive !== 1) {
    return res.status(403).send({ code: 403, message: '账号已禁用或不存在' });
  }
  const isAdmin = await rbac.isAdmin(userId);
  if (isAdmin) return next();              // Admin 通杀

  if (isAdminOnlyPath(req.path)) {
    return res.status(403).send({ code: 403, message: '需要管理员权限' });
  }
  const key = resolvePageKey(req.path);
  if (!key) {
    return res.status(403).send({ code: 403, message: '无权访问' });
  }
  const pages = await rbac.effectivePages(userId);
  if (pages.includes(key)) return next();
  return res.status(403).send({ code: 403, message: `无权访问页面：${key}` });
}
```

> 注：`GET /api/user` 与 `PUT /api/user/password` 属自助端点，**不**经 pageKey 拦截 —— 在 `resolvePageKey` 中 `/api/user`（无 s）不匹配任何前缀返回 null 会被拒。**因此把 `/api/user` 加入白名单后于 Task 12 内部自行校验登录态**，或在此中间件对精确路径 `/api/user`、`/api/user/password` 提前 `return next()`。实现时采用后者：在上面 `if (pathLower.startsWith('/api/'))` 内最前面加：

```ts
  if (['/api/user', '/api/user/password'].includes(pathLower)) {
    // 仅需登录态（已校验 token），放行给路由自身用 userId
    return next();
  }
```

- [ ] **Step 3: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

- [ ] **Step 4: 提交**

```bash
git add back/loaders/express.ts
git commit -m "feat(rbac): /api/* 按 pageKey 拦截，Admin 通杀，禁用用户拒绝"
```

---

## Phase 7：管理 API

### Task 12: 自助端点改造（GET /api/user 返回 pageKey）

**Files:**
- Modify: `back/api/user.ts`

> 先读 `back/api/user.ts` 找到现有 `GET /` 或返回用户信息的路由。改为基于 `req.auth.userId` 返回。

- [ ] **Step 1: 改 GET /api/user**

```ts
// 在 back/api/user.ts 内，import 追加：
import RbacService from '../services/rbac';
// 现有 GET 当前用户信息的处理改为：
route.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const logger: Logger = Container.get('logger');
  try {
    const userId = (req as any).auth?.userId as number;
    const rbac = Container.get(RbacService);
    const user = await rbac.findUserById(userId);
    const pages = await rbac.effectivePages(userId);
    const isAdmin = await rbac.isAdmin(userId);
    return res.send({
      code: 200,
      data: {
        username: user?.username, nickname: user?.nickname,
        email: user?.email, isAdmin, pages,
      },
    });
  } catch (e) {
    logger.error('🔥 error: %o', e);
    return next(e);
  }
});
```

- [ ] **Step 2: 改自助改密 PUT /api/user/password**

```ts
route.put('/password',
  celebrate({ body: Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required(),
  }) }),
  async (req: Request, res: Response, next: NextFunction) => {
    const logger: Logger = Container.get('logger');
    try {
      const userId = (req as any).auth?.userId as number;
      const rbac = Container.get(RbacService);
      const user = await rbac.findUserById(userId);
      const bcrypt = (await import('bcryptjs')).default;
      const ok = user && (await bcrypt.compare(req.body.oldPassword, user.passwordHash || ''));
      if (!ok) return res.send({ code: 400, message: '原密码不正确' });
      await rbac.resetPassword(userId, req.body.newPassword);
      return res.send({ code: 200 });
    } catch (e) {
      logger.error('🔥 error: %o', e);
      return next(e);
    }
  });
```

- [ ] **Step 3: 编译校验 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增 error

```bash
git add back/api/user.ts
git commit -m "feat(rbac): GET /api/user 返回 pageKey，自助改密走 bcrypt"
```

### Task 13: 用户管理路由 /api/users

**Files:**
- Create: `back/api/users.ts`
- Modify: `back/api/index.ts`

> 严格照 `back/api/env.ts` 的 Router + celebrate + `Container.get` 模式。

- [ ] **Step 1: 写路由**

```ts
// back/api/users.ts
import { Joi, celebrate } from 'celebrate';
import { NextFunction, Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import RbacService from '../services/rbac';
const route = Router();

export default (app: Router) => {
  app.use('/users', route);

  route.get('/', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      const data = await Container.get(RbacService).listUsers();
      return res.send({ code: 200, data });
    } catch (e) { logger.error('🔥 error: %o', e); return next(e); }
  });

  route.post('/',
    celebrate({ body: Joi.object({
      username: Joi.string().min(2).required(),
      password: Joi.string().min(6).required(),
      nickname: Joi.string().allow('').optional(),
      email: Joi.string().allow('').optional(),
      roleIds: Joi.array().items(Joi.number()).required(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        const id = await Container.get(RbacService).createUser(req.body);
        return res.send({ code: 200, data: { id } });
      } catch (e: any) {
        logger.error('🔥 error: %o', e);
        return res.send({ code: 400, message: e.message });
      }
    });

  route.put('/:id',
    celebrate({ body: Joi.object({
      nickname: Joi.string().allow('').optional(),
      email: Joi.string().allow('').optional(),
      isActive: Joi.number().valid(0, 1).optional(),
      roleIds: Joi.array().items(Joi.number()).optional(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        await Container.get(RbacService).updateUser(Number(req.params.id), req.body);
        return res.send({ code: 200 });
      } catch (e: any) {
        logger.error('🔥 error: %o', e);
        return res.send({ code: 400, message: e.message });
      }
    });

  route.put('/:id/password',
    celebrate({ body: Joi.object({ password: Joi.string().min(6).required() }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        await Container.get(RbacService).resetPassword(Number(req.params.id), req.body.password);
        return res.send({ code: 200 });
      } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
    });

  route.delete('/:id', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      await Container.get(RbacService).deleteUser(Number(req.params.id));
      return res.send({ code: 200 });
    } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
  });
};
```

- [ ] **Step 2: 在 api/index.ts 挂载**

import `users from './users';` 并在 `return app;` 前 `users(app);`。

- [ ] **Step 3: 编译校验 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add back/api/users.ts back/api/index.ts
git commit -m "feat(rbac): /api/users 用户管理路由"
```

### Task 14: 角色管理路由 /api/roles

**Files:**
- Create: `back/api/roles.ts`
- Modify: `back/api/index.ts`

- [ ] **Step 1: 写路由**

```ts
// back/api/roles.ts
import { Joi, celebrate } from 'celebrate';
import { Router } from 'express';
import { Container } from 'typedi';
import { Logger } from 'winston';
import RbacService from '../services/rbac';
import { PAGE_KEYS } from '../shared/pageKeys';
const route = Router();

export default (app: Router) => {
  app.use('/roles', route);

  route.get('/', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      const data = await Container.get(RbacService).listRoles();
      // 附带全部可选 pageKey 供前端渲染勾选框
      return res.send({ code: 200, data, allPageKeys: PAGE_KEYS });
    } catch (e) { logger.error('🔥 error: %o', e); return next(e); }
  });

  route.post('/',
    celebrate({ body: Joi.object({
      name: Joi.string().min(2).required(),
      description: Joi.string().allow('').optional(),
      pageKeys: Joi.array().items(Joi.string()).required(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        const id = await Container.get(RbacService).createRole(req.body);
        return res.send({ code: 200, data: { id } });
      } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
    });

  route.put('/:id',
    celebrate({ body: Joi.object({
      name: Joi.string().min(2).optional(),
      description: Joi.string().allow('').optional(),
      pageKeys: Joi.array().items(Joi.string()).optional(),
    }) }),
    async (req, res, next) => {
      const logger: Logger = Container.get('logger');
      try {
        await Container.get(RbacService).updateRole(Number(req.params.id), req.body);
        return res.send({ code: 200 });
      } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
    });

  route.delete('/:id', async (req, res, next) => {
    const logger: Logger = Container.get('logger');
    try {
      await Container.get(RbacService).deleteRole(Number(req.params.id));
      return res.send({ code: 200 });
    } catch (e: any) { logger.error('🔥 error: %o', e); return res.send({ code: 400, message: e.message }); }
  });
};
```

- [ ] **Step 2: 在 api/index.ts 挂载**

import `roles from './roles';` 并 `roles(app);`。

- [ ] **Step 3: 编译校验 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add back/api/roles.ts back/api/index.ts
git commit -m "feat(rbac): /api/roles 角色管理路由"
```

---

## Phase 8：后端冒烟（构建并验证）

### Task 15: 构建镜像并跑后端冒烟

**Files:**
- 无（验证用）

> 此 Task 验证 Phase 1–7 的后端整体行为。前端尚未改，用 curl 直打 API。

- [ ] **Step 1: 用源码构建镜像**

Run:
```bash
cd docker && docker build -f Dockerfile -t fbd-jobcenter-rbac:test ..
```
Expected: 构建成功（前端 `umi build` + 后端编译通过）。若 `Dockerfile` 期望特定构建上下文，按其 `COPY` 路径调整 context（实现时阅读 `docker/Dockerfile` 确认）。

- [ ] **Step 2: 临时起容器（独立数据卷，不碰生产 data）**

Run:
```bash
docker run -d --name rbac-smoke -p 5701:5700 -v "$PWD/_smoke_data:/ql/data" fbd-jobcenter-rbac:test
sleep 20
```

- [ ] **Step 3: 初始化并登录（迁移来的 admin）**

> 全新数据卷时 qinglong 需先初始化设管理员；按面板初始化流程设 admin/admin（或读日志确认）。然后：
```bash
TOKEN=$(curl -s -X POST http://localhost:5701/api/user/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo "$TOKEN"
```
Expected: 拿到非空 token。

- [ ] **Step 4: Admin 通杀 —— 各页面 API 均 200**

Run:
```bash
for p in crons envs scripts subscriptions dependencies configs logs; do
  echo -n "$p: "; curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" "http://localhost:5701/api/$p"
done
```
Expected: 全部 200。

- [ ] **Step 5: 建 Viewer 用户并验证受限**

Run:
```bash
# 取 Viewer 角色 id
ROLES=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5701/api/roles)
echo "$ROLES"
# 用返回里的 Viewer id 建用户（把 <VID> 换成实际 id）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"viewer1","password":"viewer123","roleIds":[<VID>]}' \
  http://localhost:5701/api/users
# Viewer 登录
VTOKEN=$(curl -s -X POST http://localhost:5701/api/user/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"viewer1","password":"viewer123"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
echo -n "viewer crons(应200): "; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $VTOKEN" http://localhost:5701/api/crons
echo -n "viewer envs(应403): "; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $VTOKEN" http://localhost:5701/api/envs
echo -n "viewer users(应403): "; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $VTOKEN" http://localhost:5701/api/users
```
Expected: crons=200，envs=403，users=403。

- [ ] **Step 6: 重启幂等验证**

Run:
```bash
docker restart rbac-smoke && sleep 20
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5701/api/users | python -m json.tool
```
Expected: 用户列表仍是 admin + viewer1（未重复迁移、未丢失）。

- [ ] **Step 7: 清理**

Run:
```bash
docker rm -f rbac-smoke && rm -rf docker/_smoke_data
```

- [ ] **Step 8: 记录结果**（无代码提交；若发现缺陷回到对应 Task 修复）

---

## Phase 9：前端

> umi + antd + react。先读 `src/pages/setting/index.tsx` 看 Tab 注册方式、读 `src/pages/env/index.tsx` 看 antd Table/Modal CRUD 模式、读 `src/layouts/index.tsx` 看菜单与 `useModel`/请求封装。前端无单测，靠 Phase 10 浏览器冒烟。每个 Task 完成后 `npm run build`（或 `umi build`）确保编译通过再提交。

### Task 16: 角色管理 Tab

**Files:**
- Create: `src/pages/setting/roleManage.tsx`
- Modify: `src/pages/setting/index.tsx`

- [ ] **Step 1: 写组件**（antd Table + Modal；列：名称/描述/内置；编辑弹窗用 `Checkbox.Group` 列出后端 `allPageKeys`）

实现要点（照 `src/pages/env/index.tsx` 的 request 封装 `request.get/post/put/delete`）：
- `GET /api/roles` 渲染列表与 `allPageKeys`。
- 新建/编辑：表单含 name、description、`pageKeys`(Checkbox.Group)。
- 删除：`isBuiltin` 行禁用删除按钮。

```tsx
// src/pages/setting/roleManage.tsx —— 结构骨架（按 env 页 request/antd 习惯补全）
import React, { useEffect, useState } from 'react';
import { Button, Table, Modal, Form, Input, Checkbox, message, Popconfirm } from 'antd';
import { request } from '@/utils/http';
import config from '@/utils/config';

const RoleManage = () => {
  const [data, setData] = useState<any[]>([]);
  const [allKeys, setAllKeys] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => {
    const res = await request.get(`${config.apiPrefix}roles`);
    setData(res.data || []);
    setAllKeys(res.allPageKeys || []);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async () => {
    const v = await form.validateFields();
    if (editing) await request.put(`${config.apiPrefix}roles/${editing.id}`, v);
    else await request.post(`${config.apiPrefix}roles`, v);
    message.success('已保存'); setVisible(false); setEditing(null); form.resetFields(); load();
  };

  const columns = [
    { title: '角色', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description' },
    { title: '页面权限', dataIndex: 'pageKeys', render: (k: string[]) => (k || []).join(', ') },
    { title: '操作', render: (_: any, r: any) => (
      <>
        <a onClick={() => { setEditing(r); form.setFieldsValue(r); setVisible(true); }}>编辑</a>
        {r.isBuiltin !== 1 && (
          <Popconfirm title="确认删除？" onConfirm={async () => {
            await request.delete(`${config.apiPrefix}roles/${r.id}`); message.success('已删除'); load();
          }}><a style={{ marginLeft: 8 }}>删除</a></Popconfirm>
        )}
      </>
    ) },
  ];

  return (
    <>
      <Button type="primary" onClick={() => { setEditing(null); form.resetFields(); setVisible(true); }}>新建角色</Button>
      <Table rowKey="id" columns={columns} dataSource={data} style={{ marginTop: 16 }} />
      <Modal title={editing ? '编辑角色' : '新建角色'} open={visible} onOk={onSubmit}
        onCancel={() => { setVisible(false); setEditing(null); }}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input /></Form.Item>
          <Form.Item name="pageKeys" label="可访问页面" rules={[{ required: true }]}>
            <Checkbox.Group options={allKeys.map((k) => ({ label: k, value: k }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
export default RoleManage;
```

> `@/utils/http` 与 `config.apiPrefix` 的确切名称以仓库为准（读 `src/pages/env/index.tsx` 顶部 import 确认，替换之）。

- [ ] **Step 2: 在 setting/index.tsx 注册 Tab**（仅 Admin 可见 —— 用当前用户 `isAdmin` 判定，见 Task 18）

- [ ] **Step 3: 构建校验**

Run: `npm run build`（或 `npx umi build`）
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/pages/setting/roleManage.tsx src/pages/setting/index.tsx
git commit -m "feat(rbac): 前端角色管理 Tab"
```

### Task 17: 用户管理 Tab

**Files:**
- Create: `src/pages/setting/userManage.tsx`
- Modify: `src/pages/setting/index.tsx`

- [ ] **Step 1: 写组件**（antd Table；列：用户名/昵称/角色/状态；操作：编辑、重置密码、启停、删除。新建弹窗含 username/password/roleIds(多选角色)。照 Task 16 的 request/antd 习惯。）

关键调用：
- `GET /api/users` + `GET /api/roles`（取角色名映射 roleIds → 名称展示，并供多选）
- `POST /api/users`、`PUT /api/users/:id`、`PUT /api/users/:id/password`、`DELETE /api/users/:id`
- 错误时后端返回 `{code:400,message}`（如“必须保留一个 Admin”），用 `message.error(res.message)` 展示。

- [ ] **Step 2: 注册 Tab（仅 Admin）+ 构建校验**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: 提交**

```bash
git add src/pages/setting/userManage.tsx src/pages/setting/index.tsx
git commit -m "feat(rbac): 前端用户管理 Tab"
```

### Task 18: 菜单按权限过滤 + 当前用户 + Admin Tab 可见性

**Files:**
- Modify: `src/layouts/index.tsx`

> 先读现有 layout 如何获取用户信息（很可能已调 `/api/user`）。后端已让 `/api/user` 返回 `{username,nickname,isAdmin,pages}`。

- [ ] **Step 1: 取 pages/isAdmin 过滤菜单**

在 layout 拉取 `/api/user` 后：
- 把 `pages`（pageKey 数组）与路由表的 pageKey 对应，Admin 时全显，否则只显 `pages` 命中的菜单项。
- 顶部展示 `nickname || username`。
- 把 `isAdmin` 通过 context/model 传给 `setting/index.tsx`，用于决定是否渲染「用户管理 / 角色管理」Tab。

```tsx
// 伪代码要点（按现有 layout 写法落地）：
// const { pages, isAdmin } = userInfo;
// const menuData = ALL_MENU.filter(m => isAdmin || pages.includes(m.pageKey));
```

> 路由 → pageKey 的前端映射与后端 `PAGE_KEYS` 保持一致（dashboard/crons/subscriptions/envs/configs/scripts/dependencies/logs/settings）。

- [ ] **Step 2: 构建校验**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: 提交**

```bash
git add src/layouts/index.tsx
git commit -m "feat(rbac): 侧边栏按权限过滤 + 显示当前用户"
```

---

## Phase 10：品牌名迁回源码 + 部署切换

### Task 19: 品牌名改到源码 i18n + 侧边栏宽度

**Files:**
- Modify: `src/locales/zh-CN.ts`、`src/locales/en-US.ts`（或对应文件）
- Modify: 侧边栏宽度配置（`src/layouts/index.tsx` 的 `siderWidth`）

> 现状：品牌名 = i18n key「青龙」的英文值。改源码替代 `Dockerfile.fbd` 的 sed。

- [ ] **Step 1: 改 i18n 词条**

在 `src/locales/en-US.ts` 把 `'青龙'` 的值改为 `'FBD Center'`（找不到则全局搜 `青龙`/`Qinglong` 定位 locale 文件）。

- [ ] **Step 2: 改 siderWidth=260 + 标题 nowrap**

在 layout 的 ProLayout 配置把 `siderWidth` 设为 `260`；标题样式加 `white-space: nowrap`（对应 `Dockerfile.fbd` 原 sed 的两项）。

- [ ] **Step 3: 构建校验 + 提交**

Run: `npm run build`

```bash
git add src/locales src/layouts/index.tsx
git commit -m "style(rbac): 品牌名/侧边栏改回源码，准备退役 sed 补丁"
```

### Task 20: compose 切到主 Dockerfile，退役 Dockerfile.fbd

**Files:**
- Modify: `docker/docker-compose.yml`
- Delete: `docker/Dockerfile.fbd`

- [ ] **Step 1: 改 compose build**

把 `dockerfile: Dockerfile.fbd` 改为 `dockerfile: Dockerfile`（context 按 `docker/Dockerfile` 实际需要设为仓库根 `..`；实现时读该 Dockerfile 的 COPY 路径确认 context）。镜像名保持 `fbd-job-center:latest`。

- [ ] **Step 2: 删除退役文件**

Run: `git rm docker/Dockerfile.fbd`

- [ ] **Step 3: 提交**

```bash
git add docker/docker-compose.yml
git commit -m "build(rbac): compose 从源码构建，退役 Dockerfile.fbd"
```

---

## Phase 11：端到端验收

### Task 21: 全量构建 + 浏览器冒烟

**Files:** 无

- [ ] **Step 1: compose 构建并起**

Run:
```bash
cd docker && docker compose up -d --build && sleep 20 && docker compose ps
```
Expected: 容器 healthy，端口 5700，HTTP 200。

> ⚠️ 该步会用**生产数据卷** `docker/data`。首次会把现有管理员迁移为首个 Admin 用户。**先备份**：`cp -r docker/data docker/data.bak`。

- [ ] **Step 2: 浏览器验收清单**（手动，逐条勾）

- [ ] 用原管理员账号密码可登录（迁移成功）。
- [ ] 侧边栏显示全部页面 + 品牌名「FBD Center」单行不换行。
- [ ] 系统设置出现「用户管理 / 角色管理」两个 Tab。
- [ ] 新建一个绑定 Viewer 角色的用户。
- [ ] 用该用户登录：侧边栏只剩 仪表盘/定时任务/日志；手动访问环境变量页被拦/空。
- [ ] 角色管理里给 Viewer 勾上「环境变量」，Viewer 刷新后出现该菜单且可用（无需重登 —— 实时生效）。
- [ ] 尝试删除唯一 Admin 用户被拒（提示保留 Admin）。
- [ ] Viewer 用户改自己密码成功，用新密码可登录。

- [ ] **Step 3: 验收通过后清理备份**

Run: `rm -rf docker/data.bak`（确认无误后）

---

## 备注 / 风险

- **JWT 默认密钥**：若 `JWT_SECRET` 未设仍是公开默认值。本计划不改其默认，但建议在 `docker/docker-compose.yml` 的 `environment` 加随机 `JWT_SECRET`（可作为 Task 20 顺带项）。
- **前端 request 封装/Tab 注册/菜单结构**的确切 API 名以仓库现状为准，已在相关 Task 标注「先读 X 文件确认」。
- **Dockerfile context**：`docker/Dockerfile` 是 qinglong 官方多阶段构建，COPY 路径假定特定 context，Task 15/20 需按其内容确认 build context（大概率为仓库根）。
- **2FA**：迁移保留现有 admin 的 2FA 字段；新建用户默认不开 2FA（本期不做新用户 2FA 配置 UI）。
