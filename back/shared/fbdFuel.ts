// 百分比字符串转小数比例："16.50%" -> 0.165；保留 4 位小数避免浮点尾差
export function pctToFraction(s: string): number {
  const n = parseFloat(String(s).replace('%', '').trim());
  if (Number.isNaN(n)) {
    throw new Error(`无法解析百分比: ${s}`);
  }
  return Math.round((n / 100) * 10000) / 10000;
}

// 逗号分隔的 id 串 -> 去空格去空项数组；空/undefined -> []
export function parseIds(val?: string): string[] {
  if (!val) return [];
  return String(val)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export interface FuelUpdate {
  label: string;
  rate: number;
  ids: string[];
}

// 组装要执行的更新：ground 用 payload.ground，express 用 payload.express_package；
// 对应 ids 为空的那条跳过。mzlPriceIds 形如 {ground:"1,2", express:"3"}。
export function buildFuelUpdates(payload: any, mzlPriceIds: any): FuelUpdate[] {
  const ids = mzlPriceIds || {};
  const candidates = [
    { label: 'Ground', pct: payload?.ground, raw: ids.ground },
    { label: 'Express', pct: payload?.express_package, raw: ids.express },
  ];
  const updates: FuelUpdate[] = [];
  for (const c of candidates) {
    const idList = parseIds(c.raw);
    if (idList.length === 0) continue;
    if (c.pct === undefined || c.pct === null || c.pct === '') {
      throw new Error(`${c.label} 配置了 MZL_Priceid 但 payload 缺少对应费率`);
    }
    updates.push({ label: c.label, rate: pctToFraction(c.pct), ids: idList });
  }
  return updates;
}
