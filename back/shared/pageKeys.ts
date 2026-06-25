export const PAGE_KEYS = [
  'dashboard', 'crons', 'subscriptions', 'envs',
  'configs', 'scripts', 'dependencies', 'logs', 'settings',
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

// API 路径前缀 → pageKey（取最长匹配前缀）
const PREFIX_MAP: Array<[string, PageKey]> = [
  ['/api/dashboard', 'dashboard'],
  ['/api/crons', 'crons'],
  ['/api/subscriptions', 'subscriptions'],
  ['/api/envs', 'envs'],
  ['/api/configs', 'configs'],
  ['/api/scripts', 'scripts'],
  ['/api/dependencies', 'dependencies'],
  ['/api/logs', 'logs'],
  ['/api/system', 'settings'],
];

export function resolvePageKey(path: string): PageKey | null {
  const p = path.toLowerCase();
  let matched: PageKey | null = null;
  let matchedLen = -1;
  for (const [prefix, key] of PREFIX_MAP) {
    if ((p === prefix || p.startsWith(prefix + '/')) && prefix.length > matchedLen) {
      matched = key;
      matchedLen = prefix.length;
    }
  }
  return matched;
}

// 用户/角色管理端点：额外要求 Admin
export function isAdminOnlyPath(path: string): boolean {
  const p = path.toLowerCase();
  return ['/api/users', '/api/roles'].some(
    (x) => p === x || p.startsWith(x + '/'),
  );
}

export function computeEffectivePages(rolePages: string[][]): string[] {
  const set = new Set<string>();
  for (const pages of rolePages) for (const k of pages) set.add(k);
  return Array.from(set);
}
