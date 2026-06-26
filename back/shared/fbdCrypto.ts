import crypto from 'crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function keyBuf(keyHex: string): Buffer {
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) {
    throw new Error('FBD_SECRET_KEY 必须是 64 位 hex（32 字节）');
  }
  return buf;
}

// 输出 base64( iv[12] + authTag[16] + ciphertext )
export function encrypt(plaintext: string, keyHex: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blob: string, keyHex: string): string {
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
