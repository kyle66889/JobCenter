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
import { FbdTaskStatus } from '../shared/fbd';

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
      { table: 'FbdTasks', column: 'MZL_PriceID', type: 'JSON' },
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

    // FBD 中心：表为空时种子一条示例（类型与脚本/分发器一致：fedex_fuel_charge）
    const fbdCount = await FbdTaskModel.count();
    if (fbdCount === 0) {
      await FbdTaskModel.create({
        title: 'FedEx 燃油附加费（示例）',
        type: 'fedex_fuel_charge',
        source: 'manual',
        payload: { note: '示例待审批数据；未配置 MZL_PriceID，approve 会提示未携带 id', rates: {} },
        status: FbdTaskStatus.pending,
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
