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
