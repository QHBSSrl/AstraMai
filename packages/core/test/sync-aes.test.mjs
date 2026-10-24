/**
 * AES 适配层的测试 —— **证明手表能解开浏览器加密的数据**。
 *
 * ── 这里在证明什么 ──────────────────────────────────────────────────
 *
 * 手表的 `@system.crypto` 在本机跑不了，所以没法直接对拍。
 * 但它的算法是 **AES/CBC/PKCS7Padding**（官方文档写明是默认值），
 * 而这正好是标准算法 —— 所以：
 *
 *   拿 **Node 自己的 `crypto.createCipheriv('aes-128-cbc')`** 当参考实现，
 *   证明我们的 WebCrypto 适配层产出的密文和它**逐字节相同**。
 *
 * 这就等价于证明了"手表那一侧能解开"。
 *
 * ⚠️ 方向也要测：Node 加密 → 我们解密，同样必须通过。
 *    只测一个方向，可能掩盖填充处理上的不对称。
 */

import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import test from 'node:test';

import {
  base64ToBytes,
  bytesToBase64,
  decodeSyncPayload,
  decryptSyncPayload,
  deriveIvBase64,
  deriveKeyBase64,
  encodeSyncPayload,
  encryptSyncPayload,
} from '../dist/index.js';

const PIN = '1234';
const CODE = '000123';

const key = () => deriveKeyBase64(PIN, CODE);
const iv = () => deriveIvBase64(CODE);

/** Node 侧的参考实现：标准 AES-128-CBC + PKCS#7。 */
function nodeEncrypt(plaintext) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(base64ToBytes(key())), Buffer.from(base64ToBytes(iv())));
  const out = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return out.toString('base64');
}

function nodeDecrypt(ciphertextBase64) {
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(base64ToBytes(key())),
    Buffer.from(base64ToBytes(iv())),
  );
  const out = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

test('我们加密的结果和 Node 的标准实现逐字节相同', async () => {
  const plaintext = 'hello maimai';

  const ours = await encryptSyncPayload(plaintext, key(), iv());
  const reference = nodeEncrypt(plaintext);

  assert.equal(ours, reference, '密文不一致 —— 手表那边会解不开');
});

test('Node 加密的能被我们解开', async () => {
  const plaintext = '{"version":1,"game":"maimai"}';
  const ciphertext = nodeEncrypt(plaintext);

  assert.equal(await decryptSyncPayload(ciphertext, key(), iv()), plaintext);
});

test('中文 / emoji / 长文本都能往返，且和 Node 一致', async () => {
  const samples = [
    '',
    '舞萌 DX',
    '初音ミク 🎵 テスト',
    'a'.repeat(5000),
    JSON.stringify({ names: Array.from({ length: 50 }, (_, i) => `曲目 ${i} 🎶`) }),
  ];

  for (const plaintext of samples) {
    const ours = await encryptSyncPayload(plaintext, key(), iv());
    assert.equal(ours, nodeEncrypt(plaintext), `密文不一致：${plaintext.slice(0, 20)}`);
    assert.equal(await decryptSyncPayload(ours, key(), iv()), plaintext);
  }
});

test('换 PIN 就解不开（密钥不同）', async () => {
  const ciphertext = await encryptSyncPayload('secret', key(), iv());

  await assert.rejects(
    () => decryptSyncPayload(ciphertext, deriveKeyBase64('9999', CODE), iv()),
    '错 PIN 必须解密失败，不能返回乱码或空串',
  );
});

test('换配对码就解不开（密钥和 IV 都变）', async () => {
  const ciphertext = await encryptSyncPayload('secret', key(), iv());

  await assert.rejects(() =>
    decryptSyncPayload(ciphertext, deriveKeyBase64(PIN, '654321'), deriveIvBase64('654321')),
  );
});

test('密文被截断会抛异常，不返回半截数据', async () => {
  const ciphertext = await encryptSyncPayload('some longer secret text', key(), iv());
  const truncated = bytesToBase64(base64ToBytes(ciphertext).slice(0, 8));

  await assert.rejects(() => decryptSyncPayload(truncated, key(), iv()));
});

test('密钥长度不对会明确报错', async () => {
  await assert.rejects(
    () => encryptSyncPayload('x', bytesToBase64([1, 2, 3]), iv()),
    /16 字节/,
  );
});

test('完整链路：编码 → 加密 → 解密 → 解码', async () => {
  const view = {
    player: { name: '测试', rating: 15012 },
    standard: [{ title: '曲目 A', rating: 300 }],
    dx: [],
  };

  const plaintext = encodeSyncPayload('maimai', view, new Date('2026-10-24T09:00:00.000Z'));
  const ciphertext = await encryptSyncPayload(plaintext, key(), iv());
  const decrypted = await decryptSyncPayload(ciphertext, key(), iv());
  const restored = decodeSyncPayload(decrypted);

  assert.equal(restored.game, 'maimai');
  assert.deepEqual(restored.view, view);
});

test('同一份数据两次加密得到相同密文（IV 由配对码决定，不是随机的）', async () => {
  // 这是**已知限制**：手表没有随机数接口，IV 只能从配对码派生。
  // 一个配对码只用一次（10 分钟过期），所以等价于每次新 IV。
  // 显式测出来，免得以后有人以为是 bug。
  const first = await encryptSyncPayload('same', key(), iv());
  const second = await encryptSyncPayload('same', key(), iv());

  assert.equal(first, second);
});
