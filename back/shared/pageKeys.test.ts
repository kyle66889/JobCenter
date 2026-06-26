import { test } from 'node:test';
import assert from 'node:assert';
import {
  PAGE_KEYS,
  resolvePageKey,
  isAdminOnlyPath,
  computeEffectivePages,
  assertNotLastAdmin,
} from './pageKeys';

test('PAGE_KEYS 覆盖 10 个页面（含 fbd）', () => {
  assert.deepStrictEqual([...PAGE_KEYS], [
    'dashboard', 'crons', 'subscriptions', 'envs',
    'configs', 'scripts', 'dependencies', 'logs', 'settings', 'fbd',
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

test('删/停最后一个 Admin 抛错', () => {
  assert.throws(() => assertNotLastAdmin(0, 'delete'));
  assert.throws(() => assertNotLastAdmin(0, 'disable'));
});

test('还有其他 Admin 时放行', () => {
  assert.doesNotThrow(() => assertNotLastAdmin(2, 'delete'));
});

test('resolvePageKey 把 /api/fbd 映射到 fbd', () => {
  assert.strictEqual(resolvePageKey('/api/fbd'), 'fbd');
  assert.strictEqual(resolvePageKey('/api/fbd/tasks'), 'fbd');
  assert.strictEqual(resolvePageKey('/api/fbd/tasks/5'), 'fbd');
});

test('isAdminOnlyPath：fbd 审批/拒绝端点要求 Admin，列表不要求', () => {
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks/5/approve'), true);
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks/5/reject'), true);
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks'), false);
  assert.strictEqual(isAdminOnlyPath('/api/fbd/tasks/5'), false);
});
