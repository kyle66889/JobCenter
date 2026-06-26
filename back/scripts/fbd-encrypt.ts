import { encrypt } from '../shared/fbdCrypto';

const key = process.env.FBD_SECRET_KEY;
const plaintext = process.argv[2];

if (!key) {
  console.error('缺少环境变量 FBD_SECRET_KEY');
  process.exit(1);
}
if (!plaintext) {
  console.error(
    "用法: FBD_SECRET_KEY=<hex> node -r ts-node/register back/scripts/fbd-encrypt.ts '<明文连接JSON>'",
  );
  process.exit(1);
}

console.log(encrypt(plaintext, key));
