import { test } from 'node:test';
import assert from 'node:assert';
import { validateSqlQuery } from './fbdQuery';

test('validateSqlQuery：合法 SQL 通过', () => {
  const r = validateSqlQuery(
    "SELECT TOP 100 * FROM MZL_Price WITH(NOLOCK)",
  );
  assert.deepStrictEqual(r, { ok: true });
});

test('validateSqlQuery：大小写混合通过', () => {
  const r = validateSqlQuery(
    "select top 50 col FROM dbo.Table WITH(nolock) where id > 1",
  );
  assert.deepStrictEqual(r, { ok: true });
});

test('validateSqlQuery：空字符串 → SELECT 开头', () => {
  const r = validateSqlQuery('');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /SELECT 开头/);
});

test('validateSqlQuery：不以 SELECT 开头', () => {
  const r = validateSqlQuery('UPDATE MZL_Price SET FuelRate=0.1');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /SELECT 开头/);
});

test('validateSqlQuery：含 -- 注释 → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) -- comment",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /注释/);
});

test('validateSqlQuery：含 /* */ 注释 → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 /* comment */ * FROM T WITH(NOLOCK)",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /注释/);
});

test('validateSqlQuery：含分号 → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK); SELECT 1",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /分号/);
});

test('validateSqlQuery：缺 TOP → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT * FROM MZL_Price WITH(NOLOCK)",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /TOP/);
});

test('validateSqlQuery：缺 NOLOCK → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 100 * FROM MZL_Price",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /NOLOCK/);
});

test('validateSqlQuery：含 UPDATE → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 1 * FROM T WITH(NOLOCK) WHERE UPDATE=1",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 DELETE → 拒绝（不以 SELECT 开头）', () => {
  const r = validateSqlQuery("DELETE FROM T");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /SELECT 开头/);
});

test('validateSqlQuery：含 DROP → 拒绝（作为词边界）', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) WHERE DROP=1",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 EXEC → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) EXEC sp_help",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 MERGE → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) MERGE INTO T",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});

test('validateSqlQuery：含 UNION → 拒绝', () => {
  const r = validateSqlQuery(
    "SELECT TOP 10 * FROM T WITH(NOLOCK) UNION SELECT TOP 10 * FROM U WITH(NOLOCK)",
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason!, /写操作/);
});
