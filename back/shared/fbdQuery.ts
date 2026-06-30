export interface QueryValidationResult {
  ok: boolean;
  reason?: string;
}

// 校验顺序：SELECT 开头 → 禁注释 → 禁分号 → 必须 TOP（1–1000）→ 必须 NOLOCK → 禁写/危险关键字
export function validateSqlQuery(sql: string): QueryValidationResult {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  if (!/^SELECT\b/.test(upper)) {
    return { ok: false, reason: 'SQL 必须以 SELECT 开头' };
  }
  if (/--|\/\*/.test(trimmed)) {
    return { ok: false, reason: '不允许使用注释（-- 或 /* */）' };
  }
  if (/;/.test(trimmed)) {
    return { ok: false, reason: '不允许使用分号（只允许单条语句）' };
  }
  if (!/\bTOP\b/.test(upper)) {
    return { ok: false, reason: '缺少 TOP（如 SELECT TOP 100）' };
  }
  const topMatch = upper.match(/\bTOP\s+(\d+)\b/);
  if (!topMatch || parseInt(topMatch[1], 10) > 1000) {
    return { ok: false, reason: 'TOP 值必须为 1–1000（如 SELECT TOP 100）' };
  }
  if (!/\bNOLOCK\b/.test(upper)) {
    return { ok: false, reason: '缺少 NOLOCK（如 WITH(NOLOCK)）' };
  }
  if (/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|MERGE|GRANT|BACKUP|UNION|OPENROWSET|OPENQUERY|OPENDATASOURCE)\b/.test(upper)) {
    return { ok: false, reason: '不允许写操作或危险关键字' };
  }
  return { ok: true };
}
