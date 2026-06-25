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
  avatar?: string;

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
    this.avatar = options.avatar || '';
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
  avatar: DataTypes.STRING,
});
