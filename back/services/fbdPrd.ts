import { QueryTypes, Sequelize } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { buildFuelUpdates } from '../shared/fbdFuel';
import { validateSqlQuery } from '../shared/fbdQuery';
import { createPrdSequelize } from './fbdPrdConn';

@Service()
export default class FbdPrdService {
  private db?: Sequelize;

  constructor(@Inject('logger') private logger: winston.Logger) {}

  // 懒连接：首次用到时解密 DSN、建连接、authenticate，之后复用
  private async getDb(): Promise<Sequelize> {
    if (this.db) return this.db;
    let db: Sequelize | undefined;
    try {
      db = createPrdSequelize();
      await db.authenticate();
      this.db = db;
      return db;
    } catch (e) {
      if (db) await db.close().catch(() => {});
      throw e;
    }
  }

  // 按任务类型分发；mzlPriceIds 由调用方（approve）从任务 MZL_PriceID 列传入
  public async apply(
    type: string,
    payload: any,
    mzlPriceIds: any,
  ): Promise<string> {
    switch (type) {
      case 'fedex_fuel_charge':
        return this.updateFuelSurcharge(payload, mzlPriceIds);
      case 'Surcharge':
        return '已确认（Surcharge 类型暂无自动处理）';
      default:
        throw new Error(`未知任务类型: ${type}`);
    }
  }

  public async updateFuelSurcharge(
    payload: any,
    mzlPriceIds: any,
  ): Promise<string> {
    const updates = buildFuelUpdates(payload, mzlPriceIds);
    if (updates.length === 0) {
      throw new Error('任务未携带任何 MZL_Priceid（MZL_PriceID 为空）');
    }
    const db = await this.getDb();
    const parts: string[] = [];
    for (const u of updates) {
      // 参数化更新，防注入；IN (:ids) 由 sequelize 展开数组
      const [, affected] = await db.query(
        'update MZL_Price set FuelRate = :rate where MZL_Priceid in (:ids)',
        { replacements: { rate: u.rate, ids: u.ids }, type: QueryTypes.UPDATE },
      );
      // mssql 下受影响行数不一定可靠，取不到就用 ids 数量兜底
      const n = typeof affected === 'number' ? affected : u.ids.length;
      parts.push(`${u.label}=${u.rate} 更新 ${n} 行`);
      this.logger.info(
        '[fbdPrd] fuel %s rate=%s ids=%s',
        u.label,
        u.rate,
        u.ids.join(','),
      );
    }
    return parts.join('；');
  }

  public async queryRaw(sql: string): Promise<{ rows: any[]; count: number }> {
    const validation = validateSqlQuery(sql);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }
    const db = await this.getDb();
    const rows: any[] = await db.query(sql, { type: QueryTypes.SELECT });
    const limited = rows.slice(0, 500);
    return { rows: limited, count: rows.length };
  }
}
