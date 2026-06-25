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
