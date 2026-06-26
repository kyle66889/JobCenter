import { DataTypes, Model } from 'sequelize';
import { sequelize } from '.';
import { FbdTaskStatus } from '../shared/fbd';

export class FbdTask {
  id?: number;
  title?: string;
  type?: string;
  source?: string;
  payload?: any;
  MZL_PriceID?: any;
  status?: FbdTaskStatus;
  result?: string;
  operator?: string;
  timestamp?: string;

  constructor(options: FbdTask) {
    this.id = options.id;
    this.title = options.title;
    this.type = options.type;
    this.source = options.source || 'manual';
    this.payload = options.payload ?? {};
    this.MZL_PriceID = options.MZL_PriceID ?? {};
    this.status =
      typeof options.status === 'number'
        ? options.status
        : FbdTaskStatus.pending;
    this.result = options.result || '';
    this.operator = options.operator || '';
    this.timestamp = options.timestamp || new Date().toString();
  }
}

export interface FbdTaskInstance extends Model<FbdTask, FbdTask>, FbdTask {}

export const FbdTaskModel = sequelize.define<FbdTaskInstance>('FbdTask', {
  title: DataTypes.STRING,
  type: DataTypes.STRING,
  source: DataTypes.STRING,
  payload: DataTypes.JSON,
  MZL_PriceID: DataTypes.JSON,
  status: DataTypes.NUMBER,
  result: DataTypes.TEXT,
  operator: DataTypes.STRING,
  timestamp: DataTypes.STRING,
});
