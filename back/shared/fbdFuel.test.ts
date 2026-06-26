import { test } from 'node:test';
import assert from 'node:assert';
import { pctToFraction, parseIds, buildFuelUpdates } from './fbdFuel';

test('pctToFraction：百分比转小数比例', () => {
  assert.strictEqual(pctToFraction('16.50%'), 0.165);
  assert.strictEqual(pctToFraction('17.00%'), 0.17);
  assert.strictEqual(pctToFraction('0%'), 0);
  assert.strictEqual(pctToFraction('28.5%'), 0.285);
});

test('pctToFraction：非法输入抛错', () => {
  assert.throws(() => pctToFraction('abc'), /无法解析百分比/);
  assert.throws(() => pctToFraction(''), /无法解析百分比/);
});

test('parseIds：逗号分隔去空格去空项', () => {
  assert.deepStrictEqual(parseIds('123,124'), ['123', '124']);
  assert.deepStrictEqual(parseIds(' 1 , ,2 '), ['1', '2']);
  assert.deepStrictEqual(parseIds(''), []);
  assert.deepStrictEqual(parseIds(undefined), []);
});

test('buildFuelUpdates：两条都有 id', () => {
  const r = buildFuelUpdates(
    { ground: '16.50%', express_package: '17.00%' },
    { ground: '1,2', express: '3' },
  );
  assert.deepStrictEqual(r, [
    { label: 'Ground', rate: 0.165, ids: ['1', '2'] },
    { label: 'Express', rate: 0.17, ids: ['3'] },
  ]);
});

test('buildFuelUpdates：仅 ground / 仅 express', () => {
  assert.deepStrictEqual(
    buildFuelUpdates({ ground: '16.50%' }, { ground: '1', express: '' }),
    [{ label: 'Ground', rate: 0.165, ids: ['1'] }],
  );
  assert.deepStrictEqual(
    buildFuelUpdates({ express_package: '17.00%' }, { express: '3' }),
    [{ label: 'Express', rate: 0.17, ids: ['3'] }],
  );
});

test('buildFuelUpdates：都空返回空数组', () => {
  assert.deepStrictEqual(buildFuelUpdates({}, {}), []);
  assert.deepStrictEqual(buildFuelUpdates({ ground: '16.50%' }, {}), []);
});

test('buildFuelUpdates：配了 id 但缺费率 → 抛清晰错误', () => {
  assert.throws(
    () => buildFuelUpdates({}, { ground: '1' }),
    /Ground 配置了 MZL_Priceid 但 payload 缺少对应费率/,
  );
});
