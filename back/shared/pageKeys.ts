export const PAGE_KEYS = [
  'dashboard', 'crons', 'subscriptions', 'envs',
  'configs', 'scripts', 'dependencies', 'logs', 'diff', 'settings', 'fbd',
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
  ['/api/fbd', 'fbd'],
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

// 用户/角色管理端点 + FBD 审批/拒绝端点：额外要求 Admin
export function isAdminOnlyPath(path: string): boolean {
  const p = path.toLowerCase();
  if (['/api/users', '/api/roles'].some((x) => p === x || p.startsWith(x + '/'))) {
    return true;
  }
  // FBD 中心：审批/拒绝端点仅 Admin（列表/详情/新建/删除走 fbd pageKey）
  if (
    p.startsWith('/api/fbd/tasks/') &&
    (p.endsWith('/approve') || p.endsWith('/reject'))
  ) {
    return true;
  }
  return false;
}

export function computeEffectivePages(rolePages: string[][]): string[] {
  const set = new Set<string>();
  for (const pages of rolePages) for (const k of pages) set.add(k);
  return Array.from(set);
}

// remainingAdminCount = 执行该操作后剩余的有效 Admin 数；< 1 则拒绝
export function assertNotLastAdmin(
  remainingAdminCount: number,
  action: 'delete' | 'disable' | 'demote',
): void {
  if (remainingAdminCount < 1) {
    throw new Error(`操作被拒绝：系统必须至少保留一个启用的 Admin（${action}）`);
  }
}
