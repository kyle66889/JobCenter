import { test } from 'node:test';
import assert from 'node:assert';
import { tailLines } from './logTail';

test('行数超过 N 时取最后 N 行', () => {
  const text = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
  assert.strictEqual(tailLines(text, 2), 'l4\nl5');
});
test('行数不足 N 时全返回', () => {
  assert.strictEqual(tailLines('a\nb', 5), 'a\nb');
});
test('忽略末尾空行', () => {
  assert.strictEqual(tailLines('a\nb\n\n', 2), 'a\nb');
});
test('空内容返回空串', () => {
  assert.strictEqual(tailLines('', 50), '');
  assert.strictEqual(tailLines(undefined as any, 50), '');
});
test('兼容 CRLF', () => {
  assert.strictEqual(tailLines('a\r\nb\r\nc', 2), 'b\nc');
});
