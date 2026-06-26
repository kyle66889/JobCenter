import { FindOptions, Op } from 'sequelize';
import { Inject, Service } from 'typedi';
import winston from 'winston';
import { FbdTask, FbdTaskModel } from '../data/fbdTask';
import { FbdTaskStatus, assertApprovable, applyUpdate } from '../shared/fbd';

@Service()
export default class FbdService {
  constructor(@Inject('logger') private logger: winston.Logger) {}

  public async list(params: {
    searchValue?: string;
    status?: number;
    page?: number;
    size?: number;
  }): Promise<{ data: FbdTask[]; total: number }> {
    const where: any = {};
    if (params.searchValue) {
      where.title = { [Op.like]: `%${params.searchValue}%` };
    }
    if (typeof params.status === 'number' && !Number.isNaN(params.status)) {
      where.status = params.status;
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
      const result = await applyUpdate(doc.type as string, doc.payload);
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
