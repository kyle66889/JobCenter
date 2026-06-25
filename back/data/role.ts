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
