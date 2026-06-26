import { QueryTypes, Sequelize } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { decrypt } from '../shared/fbdCrypto';
import { buildFuelUpdates } from '../shared/fbdFuel';

// 加载 tedious（SQL Server 驱动）。本地开发它在 node_modules 里能正常 require；
// 容器运行镜像里它被装在 /ql/fbd_modules（见 docker/Dockerfile.fbd），故做路径兜底。
function loadTedious(): any {
  try {
    return require('tedious');
  } catch (_) {
    return require('/ql/fbd_modules/tedious');
  }
}

@Service()
export default class FbdPrdService {
  private db?: Sequelize;

  constructor(@Inject('logger') private logger: winston.Logger) {}

  // 懒连接：首次用到时解密 DSN、建连接、authenticate，之后复用
  private async getDb(): Promise<Sequelize> {
    if (this.db) return this.db;
    const enc = process.env.FBD_PRD_DB_DSN_ENC;
    const key = process.env.FBD_SECRET_KEY;
    if (!enc || !key) {
      throw new Error('缺少 FBD_PRD_DB_DSN_ENC 或 FBD_SECRET_KEY');
    }
    const conf = JSON.parse(decrypt(enc, key));
    let db: Sequelize | undefined;
    try {
      db = new Sequelize({
        dialect: 'mssql',
        dialectModule: loadTedious(),
        host: conf.host,
        port: conf.port || 1433,
        database: conf.database,
        username: conf.username,
        password: conf.password,
        logging: false,
        dialectOptions: {
          options: {
            encrypt: conf.encrypt !== false,
            trustServerCertificate: conf.trustServerCertificate !== false,
          },
        },
      });
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
}
