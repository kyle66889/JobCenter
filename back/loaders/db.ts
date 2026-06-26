import Logger from './logger';
import { EnvModel } from '../data/env';
import { CrontabModel } from '../data/cron';
import { DependenceModel } from '../data/dependence';
import { AppModel } from '../data/open';
import { SystemModel } from '../data/system';
import { SubscriptionModel } from '../data/subscription';
import { CrontabViewModel } from '../data/cronView';
import { CrontabStatModel } from '../data/cronStats';
import { RunningInstanceModel } from '../data/runningInstance';
import { sequelize } from '../data';
import { UserModel } from '../data/user';
import { RoleModel } from '../data/role';
import { UserRoleModel } from '../data/userRole';
import { RolePermissionModel } from '../data/rolePermission';
import { FbdTaskModel } from '../data/fbdTask';

export default async () => {
  try {
    await CrontabModel.sync();
    await DependenceModel.sync();
    await AppModel.sync();
    await SystemModel.sync();
    await EnvModel.sync();
    await SubscriptionModel.sync();
    await CrontabViewModel.sync();
    await CrontabStatModel.sync();
    await RunningInstanceModel.sync();
    await UserModel.sync();
    await RoleModel.sync();
    await UserRoleModel.sync();
    await RolePermissionModel.sync();
    await FbdTaskModel.sync();

    // 初始化新增字段
    const migrations = [
      {
        table: 'CrontabViews',
        column: 'filterRelation',
        type: 'VARCHAR(255)',
      },
      { table: 'Subscriptions', column: 'proxy', type: 'VARCHAR(255)' },
      { table: 'CrontabViews', column: 'type', type: 'NUMBER' },
      { table: 'Subscriptions', column: 'autoAddCron', type: 'NUMBER' },
      { table: 'Subscriptions', column: 'autoDelCron', type: 'NUMBER' },
      { table: 'Crontabs', column: 'sub_id', type: 'NUMBER' },
      { table: 'Crontabs', column: 'extra_schedules', type: 'JSON' },
      { table: 'Crontabs', column: 'task_before', type: 'TEXT' },
      { table: 'Crontabs', column: 'task_after', type: 'TEXT' },
      { table: 'Crontabs', column: 'log_name', type: 'VARCHAR(255)' },
      {
        table: 'Crontabs',
        column: 'allow_multiple_instances',
        type: 'NUMBER',
      },
      { table: 'Crontabs', column: 'work_dir', type: 'VARCHAR(255)' },
      { table: 'Envs', column: 'isPinned', type: 'NUMBER' },
      { table: 'Envs', column: 'labels', type: 'JSON' },
      { table: 'Users', column: 'avatar', type: 'VARCHAR(255)' },
      { table: 'Crontabs', column: 'notify_emails', type: 'VARCHAR(255)' },
    ];

    for (const migration of migrations) {
      try {
        await sequelize.query(
          `alter table ${migration.table} add column ${migration.column} ${migration.type}`,
        );
      } catch (error) {
        // Column already exists or other error, continue
      }
    }

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

    const seedRbac = (await import('../services/auth-seed')).default;
    await seedRbac();

    Logger.info('✌️ DB loaded');
  } catch (error) {
    Logger.error('✌️ DB load failed', error);
  }
};
