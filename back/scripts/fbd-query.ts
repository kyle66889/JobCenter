import { QueryTypes } from 'sequelize';
import { validateSqlQuery } from '../shared/fbdQuery';
import { createPrdSequelize } from '../services/fbdPrdConn';

(async () => {
  const sql = process.argv[2];
  if (!sql) {
    console.error('用法: node fbd-query.js "<SQL>"');
    process.exit(1);
  }
  const v = validateSqlQuery(sql);
  if (!v.ok) {
    console.error('SQL 校验失败: ' + v.reason);
    process.exit(1);
  }
  const db = createPrdSequelize();
  try {
    const rows = await db.query(sql, { type: QueryTypes.SELECT });
    await new Promise<void>((resolve, reject) =>
      process.stdout.write(
        JSON.stringify({ rows, count: rows.length }) + '\n',
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    await db.close();
    process.exit(0);
  } catch (e: any) {
    console.error('查询失败: ' + (e?.message || String(e)));
    try {
      await db.close();
    } catch (_) {}
    process.exit(1);
  }
})();
