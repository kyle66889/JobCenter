# 设计：简单 User / Role 权限系统（对标 RMA）

- 日期：2026-06-25
- 项目：JobCenter（基于 qinglong 源码 `back/` + `src/`）
- 参考：`../rma`（.NET8 + EF Core 的 RBAC：`User / Role / UserRole / RolePermission(PageKey)` + `PagePermissionHandler`）

## 1. 目标与范围

为 JobCenter 增加一套**简单的多用户 + 角色 + 页面级权限**系统，替换 qinglong 现有的「单管理员」模型。权限粒度与执行方式完全对标 RMA：

- 用户 ↔ 角色 多对多；角色 → 一组可访问页面（`pageKey`）。
- 有某页面的 `pageKey` 即可使用该页全部功能（无「只读/可写」细分）。
- 内置 `Admin` 角色**通杀**，不看 `pageKey`。
- 权限每次请求实时查库，改权限**无需重新登录**。

### 范围内
- 4 张表：`Users / Roles / UserRoles / RolePermissions`。
- 登录改造：查 `Users` 表、bcrypt 校验、JWT 携带 `userId`。
- 鉴权中间件：按 `pageKey` 拦截 `/api/*`。
- 用户 / 角色 / 权限的 CRUD API（Admin 专属）+ 自助改密。
- 前端：系统设置内新增「用户管理」「角色管理」Tab；侧边栏按权限过滤。
- 首次启动迁移：现有管理员 → 第一个 User（Admin 角色）。
- 从源码构建自定义镜像（方案 A）。

### 明确不做（YAGNI）
- SSO / 第三方登录（RMA 的 `AuthSource` / `MzlUserId`）。
- 用户自助注册（仅 Admin 建号）。
- 额外的权限审计日志（复用 qinglong 现有登录日志）。
- 页面内「读 / 写」分级权限。
- 改动 qinglong 既有的 Open API（`/open/*`）App/scope 体系。

## 2. 数据模型

新增 4 个 Sequelize 模型，存入现有 `data/db/database.sqlite`，由 `back/loaders/db.ts` 的 `Model.sync()` 自动建表。

```
Users
  id            主键
  username      唯一，非空
  passwordHash  bcrypt 哈希
  nickname      显示名
  email         可空
  isActive      bool，默认 true
  twoFactor*    复用现有 2FA 字段（secret / activated / checking）落到用户行
  lastLoginAt   可空
  createdAt / updatedAt

Roles
  id            主键
  name          唯一，非空（如 Admin / Viewer）
  description   可空
  isBuiltin     bool；内置角色（Admin）不可删除
  createdAt

UserRoles            // 用户 ↔ 角色 多对多
  id, userId, roleId

RolePermissions      // 角色 → 可访问页面（对标 RMA RolePermission.PageKey）
  id, roleId, pageKey
```

- 用户有效权限 = 其所有角色的 `pageKey` 并集。
- `Admin` 角色通杀（不查 `pageKey`）。

## 3. PageKey 全集

前端页面 ↔ 后端 API 前缀一一对应，前后端用同一套 key。

| pageKey | 前端页面 | 受控 API 前缀 |
|---|---|---|
| `dashboard` | 仪表盘 | `/api/dashboard` 等 |
| `crons` | 定时任务 | `/api/crons` |
| `subscriptions` | 订阅管理 | `/api/subscriptions` |
| `envs` | 环境变量 | `/api/envs` |
| `configs` | 配置文件 | `/api/configs` |
| `scripts` | 脚本管理 | `/api/scripts` |
| `dependencies` | 依赖管理 | `/api/dependencies` |
| `logs` | 日志 | `/api/logs` |
| `settings` | 系统设置 | `/api/system` |

> 用户管理 / 角色管理端点（`/api/users`、`/api/roles`）**额外要求 Admin 角色**，不只是 `settings` pageKey。

## 4. 认证（登录改造）

改造 `back/services/user.ts`：

1. 按 `username` 查 `Users` 表；查不到 → 失败（沿用现有提示）。
2. `isActive == false` → 拒绝（账号已禁用）。
3. `bcrypt.compare(password, passwordHash)` 不符 → 失败。
4. 沿用现有**防爆破退避**（`retries` / `3^n` 等待）与**登录日志**。
5. 沿用现有 **2FA**：开启时返回 `420` 要求 OTP；2FA 状态落到用户行。
6. 成功 → 签发 **JWT，payload 携带 `userId`**（对标 RMA 的 NameIdentifier claim），按平台绑定并存入会话。

用户可改自己密码（`PUT /api/user/password`）；Admin 可重置任意用户密码。

## 5. 授权（鉴权拦截）

改造 `back/loaders/express.ts` 中针对 `/api/*` 的自定义中间件（对标 RMA `PagePermissionHandler`）：

```
对每个 /api/* 请求（白名单除外）：
  1. 校验 JWT，取 userId；无效 → 401
  2. 查 user.isActive；禁用 → 拒绝（即使 JWT 未过期）
  3. 查 user 的角色集合；无角色 → 403
  4. 含 Admin 角色 → 放行
  5. 否则：路径 /api/<resource> 经静态映射表得到 pageKey，
     user 的角色并集包含该 pageKey → 放行，否则 403
  6. /api/users、/api/roles 等管理端点 → 额外要求 Admin
```

- **路径 → pageKey 映射**用一张集中维护的静态表。
- 白名单（登录、health、init、2FA 登录等）保持不变。
- `/open/*` 的 App/scope 体系不受影响。

## 6. 管理 API

均要求 **Admin** 角色（自助端点除外）。

```
用户管理  /api/users
  GET    /api/users                列表（含每人角色）
  POST   /api/users                建号（用户名 + 初始密码 + 角色）
  PUT    /api/users/:id            改资料 / 启停 / 换角色
  PUT    /api/users/:id/password   Admin 重置密码
  DELETE /api/users/:id            删除

角色管理  /api/roles
  GET    /api/roles                列表（含每角色 pageKey）
  POST   /api/roles                建角色
  PUT    /api/roles/:id            改名 / 描述 / pageKey 集合
  DELETE /api/roles/:id            删角色

自助（任意登录用户）
  GET    /api/user                 当前用户信息 + 有效 pageKey 列表
  PUT    /api/user/password        改自己密码
```

**护栏**：
- 不能删除或停用最后一个 Admin 用户。
- 不能删除内置 `Admin` 角色（`isBuiltin`）。
- 不能把自己降权到失去 Admin（防自锁）。

## 7. 前端

- **系统设置**页新增两个 Tab（对标 RMA `UsersTab` / `RolesTab`）：
  - 用户管理：列表、建号、改角色、启停、重置密码。
  - 角色管理：列表；编辑角色时用勾选框列出全部 9 个 `pageKey` 配权限。
- **侧边栏按权限过滤**：登录后调 `GET /api/user` 拿有效 `pageKey`，前端路由/菜单据此隐藏无权页面（Admin 全显）。后端拦截是真防线，前端隐藏仅为体验。
- 「用户管理 / 角色管理」Tab 仅 Admin 可见。
- 顶部展示当前登录用户名 + 退出。

## 8. 迁移 / 初始化（幂等）

在 `back/loaders/db.ts` 建表后执行：

1. 建 `Admin`（isBuiltin）、示例 `Viewer` 角色。
2. 若 `Users` 表为空：读取 keyv 里现有单管理员（用户名/密码），创建第一个用户、bcrypt 哈希密码、挂 `Admin` 角色；已存在则跳过（保证重启/升级幂等）。
3. 现有 2FA 配置迁移到该 admin 用户行。
4. `Viewer` 默认 pageKey：`dashboard`、`crons`、`logs`。

## 9. 构建与部署（方案 A）

- 用 qinglong 自带 `docker/Dockerfile`（多阶段：`pnpm install` → `umi build` 前端 + 编译 `back/`）从本仓库源码构建。
- 品牌名改动从 sed 补丁**迁回源码**（`src/` i18n 词条 + 侧边栏宽度样式）；`docker/Dockerfile.fbd` 退役。
- `docker-compose.yml` 的 `build` 指向主 `Dockerfile`，镜像名保持 `fbd-job-center:latest`。
- 数据卷 `./data` 不变；新表在现有 `database.sqlite` 自动创建，老数据无损。
- 偏离上游：今后 qinglong 升级需 git 合并本仓库改动。

## 10. 测试

- **后端单测**（对标 RMA `PagePermissionHandlerTests` / `UserServiceTests`）：
  - 鉴权：Admin 通杀；普通角色按 pageKey 命中/拒绝；禁用用户拒绝；无 token 401。
  - 登录：密码正确/错误；禁用账号；bcrypt 校验；防爆破退避；迁移幂等。
  - 护栏：不能删最后一个 Admin；不能删内置角色；不能自锁。
- **冒烟**：构建镜像 → 起容器 → 迁移来的 admin 登录 → 建 Viewer 用户 → Viewer 登录只能看 `dashboard/crons/logs`，访问 `/api/envs` 返回 403。

## 11. 受影响文件（预估）

- 新增：`back/data/{user,role,userRole,rolePermission}.ts`、`back/api/{users,roles}.ts`、`back/services/{role}.ts`、鉴权 pageKey 映射表。
- 改动：`back/loaders/db.ts`（sync + 迁移）、`back/loaders/express.ts`（鉴权中间件）、`back/services/user.ts`（登录）、`back/api/user.ts`（自助）。
- 前端：`src/pages/setting/`（用户/角色 Tab）、`src/layouts/`（菜单过滤 + 当前用户）、`src/locales/`（品牌名 i18n）。
- 部署：`docker/docker-compose.yml`（build 指向主 Dockerfile）、退役 `docker/Dockerfile.fbd`。
