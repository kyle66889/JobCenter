import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import config from '../config';
import { decrypt } from '../shared/fbdCrypto';

// tedious：本地开发正常 require；运行镜像装在 /ql/fbd_modules/node_modules
export function loadTedious(): any {
  try {
    return require('tedious');
  } catch (_) {
    return require('/ql/fbd_modules/node_modules/tedious');
  }
}

// 后端进程不加载 config.sh（仅 shell 任务执行时 source），故按行解析 config.sh
function readConfigShVar(name: string): string | undefined {
  try {
    const file = path.join(config.configPath, 'config.sh');
    const content = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.+?)\\s*$`);
    let raw: string | undefined;
    for (const line of content.split(/\r?\n/)) {
      const m = re.exec(line);
      if (m) raw = m[1];
    }
    if (raw === undefined) return undefined;
    const val = raw.trim();
    if (val[0] === '"' || val[0] === "'") {
      const end = val.indexOf(val[0], 1);
      return end > 0 ? val.slice(1, end) : val.slice(1);
    }
    const h = val.search(/\s#/);
    return (h >= 0 ? val.slice(0, h) : val).trim();
  } catch (_) {
    return undefined;
  }
}

export function getConf(name: string): string | undefined {
  return process.env[name] || readConfigShVar(name);
}

// 构建（未缓存）prd Sequelize 实例；调用方负责 authenticate / close / 缓存
export function createPrdSequelize(): Sequelize {
  const enc = getConf('FBD_PRD_DB_DSN_ENC');
  const key = getConf('FBD_SECRET_KEY');
  if (!enc || !key) {
    throw new Error('缺少 FBD_PRD_DB_DSN_ENC 或 FBD_SECRET_KEY');
  }
  const conf = JSON.parse(decrypt(enc, key));
  return new Sequelize({
    dialect: 'mssql',
    dialectModule: loadTedious(),
    host: conf.host,
    port: conf.port || 1433,
    database: conf.database,
    username: conf.username,
    password: conf.password,
    logging: false,
    pool: { max: 1, min: 0, idle: 10000, acquire: 30000 },
    dialectOptions: {
      options: {
        encrypt: conf.encrypt !== false,
        trustServerCertificate: conf.trustServerCertificate !== false,
        connectTimeout: 30000,
        requestTimeout: 60000,
      },
    },
  });
}
