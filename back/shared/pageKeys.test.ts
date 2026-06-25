import { test } from 'node:test';
import assert from 'node:assert';
import {
  PAGE_KEYS,
  resolvePageKey,
  isAdminOnlyPath,
  computeEffectivePages,
} from './pageKeys';

test('PAGE_KEYS 覆盖 9 个页面', () => {
  assert.deepStrictEqual([...PAGE_KEYS], [
    'dashboard', 'crons', 'subscriptions', 'envs',
    'configs', 'scripts', 'dependencies', 'logs', 'settings',
  ]);
});

test('resolvePageKey 把 API 路径映射到 pageKey', () => {
  assert.strictEqual(resolvePageKey('/api/crons'), 'crons');
  assert.strictEqual(resolvePageKey('/api/crons/123/run'), 'crons');
  assert.strictEqual(resolvePageKey('/api/envs'), 'envs');
  assert.strictEqual(resolvePageKey('/api/system/config'), 'settings');
  assert.strictEqual(resolvePageKey('/api/dashboard'), 'dashboard');
});

test('未知路径返回 null（默认不放行）', () => {
  assert.strictEqual(resolvePageKey('/api/whatever'), null);
});

test('isAdminOnlyPath 命中 users/roles', () => {
  assert.strictEqual(isAdminOnlyPath('/api/users'), true);
  assert.strictEqual(isAdminOnlyPath('/api/roles/abc'), true);
  assert.strictEqual(isAdminOnlyPath('/api/crons'), false);
});

test('computeEffectivePages 求角色 pageKey 并集去重', () => {
  assert.deepStrictEqual(
    computeEffectivePages([['dashboard', 'crons'], ['crons', 'logs']]),
    ['dashboard', 'crons', 'logs'],
  );
});
