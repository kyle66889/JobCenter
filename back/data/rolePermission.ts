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
