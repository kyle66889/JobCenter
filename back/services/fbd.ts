import { FindOptions, Op, fn, col } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { FbdTask, FbdTaskModel } from '../data/fbdTask';
import { FbdTaskStatus, assertApprovable } from '../shared/fbd';
import FbdPrdService from './fbdPrd';

@Service()
export default class FbdService {
  constructor(
    @Inject('logger') private logger: winston.Logger,
    private fbdPrd: FbdPrdService,
  ) {}

  public async list(params: {
    searchValue?: string;
    status?: string | number;
    page?: number;
    size?: number;
  }): Promise<{ data: FbdTask[]; total: number }> {
    const where: any = {};
    if (params.searchValue) {
      where.title = { [Op.like]: `%${params.searchValue}%` };
    }
    // status 支持逗号分隔的多状态（如 "0,1"）：单个用等值，多个用 Op.in
    if (params.status !== undefined && params.status !== '') {
      const statuses = String(params.status)
        .split(',')
        .map((s) => Number(s))
        .filter((n) => !Number.isNaN(n));
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else if (statuses.length > 1) {
        where.status = { [Op.in]: statuses };
      }
    }
    const page = params.page && params.page > 0 ? params.page : 1;
    const size = params.size && params.size > 0 ? params.size : 20;
    const options: FindOptions = {
      where,
      order: [['timestamp', 'DESC']],
      offset: (page - 1) * size,
      limit: size,
    };
    const result = await FbdTaskModel.findAndCountAll(options);
    return { data: result.rows, total: result.count };
  }

  // 各状态计数（给前端 Tab 显示数量用）；可按标题搜索过滤，返回 { status: count }
  public async counts(searchValue?: string): Promise<Record<number, number>> {
    const where: any = {};
    if (searchValue) {
      where.title = { [Op.like]: `%${searchValue}%` };
    }
    const rows = (await FbdTaskModel.findAll({
      where,
      attributes: ['status', [fn('COUNT', col('id')), 'cnt']],
      group: ['status'],
      raw: true,
    })) as unknown as Array<{ status: number; cnt: number }>;
    const result: Record<number, number> = {};
    for (const r of rows) {
      result[Number(r.status)] = Number(r.cnt);
    }
    return result;
  }

  public async get(id: number): Promise<FbdTask | null> {
    return FbdTaskModel.findByPk(id);
  }

  public async create(payload: FbdTask): Promise<FbdTask> {
    const tab = new FbdTask(payload);
    return FbdTaskModel.create(tab, { returning: true });
  }

  public async approve(id: number, operator: string): Promise<FbdTask> {
    const doc = await FbdTaskModel.findByPk(id);
    if (!doc) throw new Error('任务不存在');
    assertApprovable(doc.status as FbdTaskStatus);
    await doc.update({ status: FbdTaskStatus.approving, operator });
    try {
      const result = await this.fbdPrd.apply(
        doc.type as string,
        doc.payload,
        (doc as any).MZL_PriceID,
      );
      await doc.update({ status: FbdTaskStatus.done, result });
      this.logger.info('[fbd] approve done id=%s by=%s', id, operator);
    } catch (e: any) {
      const msg = e?.message || String(e);
      await doc.update({ status: FbdTaskStatus.failed, result: msg });
      this.logger.error('[fbd] approve failed id=%s err=%s', id, msg);
    }
    return doc;
  }

  public async reject(id: number, operator: string): Promise<FbdTask> {
    const doc = await FbdTaskModel.findByPk(id);
    if (!doc) throw new Error('任务不存在');
    assertApprovable(doc.status as FbdTaskStatus);
    await doc.update({
      status: FbdTaskStatus.rejected,
      operator,
      result: '已拒绝',
    });
    this.logger.info('[fbd] reject id=%s by=%s', id, operator);
    return doc;
  }

  public async remove(ids: number[]): Promise<void> {
    await FbdTaskModel.destroy({ where: { id: ids } });
  }
}
