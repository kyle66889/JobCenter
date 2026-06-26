import { test } from 'node:test';
import assert from 'node:assert';
import { encrypt, decrypt } from './fbdCrypto';

const KEY = '0'.repeat(64); // 32 字节 hex 测试密钥
const WRONG = '1'.repeat(64);

test('encrypt→decrypt round-trip 还原原文', () => {
  const plain = '{"host":"1.2.3.4","database":"X","password":"p@ss"}';
  const blob = encrypt(plain, KEY);
  assert.notStrictEqual(blob, plain);
  assert.strictEqual(decrypt(blob, KEY), plain);
});

test('同一明文两次密文不同（随机 IV）', () => {
  assert.notStrictEqual(encrypt('abc', KEY), encrypt('abc', KEY));
});

test('错误密钥解密抛错', () => {
  const blob = encrypt('secret', KEY);
  assert.throws(() => decrypt(blob, WRONG));
});

test('篡改密文解密抛错', () => {
  const blob = encrypt('secret', KEY);
  const raw = Buffer.from(blob, 'base64');
  raw[raw.length - 1] ^= 0xff; // 翻转最后一字节
  assert.throws(() => decrypt(raw.toString('base64'), KEY));
});

test('密钥长度不对抛错', () => {
  assert.throws(() => encrypt('x', 'abcd'), /64 位 hex/);
});
