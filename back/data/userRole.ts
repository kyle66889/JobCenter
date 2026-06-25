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
