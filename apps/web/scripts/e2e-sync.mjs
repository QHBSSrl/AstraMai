/**
 * 端到端验证：core 的加密 → 真的 Worker → 解密。
 *
 * 这不是单元测试（要连本地 `wrangler dev` 的 8787），
 * 所以放在 scripts 里单独跑：
 *
 *   终端 A：cd astramai-sync && npx wrangler dev --port 8787 --local
 *   终端 B：node apps/web/scripts/e2e-sync.mjs
 *
 * 它证明的是**整条链路**，而单元测试只能证明各段：
 *
 *   · core 的密钥/IV 推导（sync-payload.test.mjs）
 *   · AES 和标准算法逐字节相同（sync-aes.test.mjs）
 *   · Worker 的四条接口（GLM 的 vitest）
 *
 * 这三段各自都对，不代表拼起来就对 —— 比如 base64 的填充差异、
 * 字段名对不上、payload 被 Worker 转义，都只有在真链路上才会暴露。
 */

import {
  decodeSyncPayload,
  decryptSyncPayload,
  deriveIvBase64,
  deriveKeyBase64,
  encodeSyncPayload,
  encryptSyncPayload,
} from '../../../packages/core/dist/index.js';

const BASE = process.env.SYNC_BASE_URL ?? 'http://127.0.0.1:8787';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function put(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: await response.json() };
}

const PIN = '7382';

async function main() {
  console.log(`\n端到端同步验证 @ ${BASE}\n`);

  // ── 健康检查 ────────────────────────────────────────────────────────
  const health = await get('/health');
  check('Worker 活着', health.status === 200 && health.body.ok === true);

  // ── 创建配对码 ──────────────────────────────────────────────────────
  const created = await post('/sync/create', { pin: PIN });
  check('创建配对码', created.status === 200 && created.body.ok === true);
  const code = created.body.code;
  check('配对码是 6 位数字', /^\d{6}$/.test(String(code)), `拿到 ${code}`);
  check('返回了 expiresAt', typeof created.body.expiresAt === 'number');

  // ── 还没上传就 GET（看 Worker 现在的行为）────────────────────────────
  const beforeUpload = await get(`/sync/${code}?pin=${PIN}`);
  console.log(
    `  ℹ️  上传前 GET → ${beforeUpload.status} ${JSON.stringify(beforeUpload.body)}` +
      (beforeUpload.body.error === 'not_uploaded' ? '（GLM 已加 not_uploaded ✅）' : '（还是 payload:null）'),
  );

  // ── 加密 + 上传 ─────────────────────────────────────────────────────
  const view = {
    player: { name: '测试玩家 🎵', rating: 15012 },
    standard: Array.from({ length: 35 }, (_, i) => ({ title: `旧曲 ${i}`, rating: 280 + i })),
    dx: Array.from({ length: 15 }, (_, i) => ({ title: `新曲 ${i}`, rating: 300 + i })),
  };

  const plaintext = encodeSyncPayload('maimai', view, new Date('2026-10-24T09:00:00.000Z'));
  const ciphertext = await encryptSyncPayload(plaintext, deriveKeyBase64(PIN, code), deriveIvBase64(code));

  check('密文和明文不同', ciphertext !== plaintext);
  check('密文不是 JSON（真的加密了）', !ciphertext.includes('{'), ciphertext.slice(0, 40));

  const uploaded = await put(`/sync/${code}`, { pin: PIN, payload: ciphertext });
  check('上传成功', uploaded.status === 200 && uploaded.body.ok === true, JSON.stringify(uploaded.body));

  // ── 拉回来解密 ──────────────────────────────────────────────────────
  const fetched = await get(`/sync/${code}?pin=${PIN}`);
  check('拉取成功', fetched.status === 200 && fetched.body.ok === true);
  check('拿到的密文和上传的一样', fetched.body.payload === ciphertext);

  const decrypted = await decryptSyncPayload(fetched.body.payload, deriveKeyBase64(PIN, code), deriveIvBase64(code));
  const restored = decodeSyncPayload(decrypted);

  check('解密后是合法载荷', restored.game === 'maimai');
  check('数据完整往返（50 首）', restored.view.standard.length === 35 && restored.view.dx.length === 15);
  check('中文和 emoji 没坏', restored.view.player.name === '测试玩家 🎵');
  check(
    '逐字段一致',
    JSON.stringify(restored.view) === JSON.stringify(view),
    '算出来的视图和原始视图不同',
  );

  // ── 读后不删：再拉一次还能拿到 ───────────────────────────────────────
  const again = await get(`/sync/${code}?pin=${PIN}`);
  check('读后不删（契约要求）', again.status === 200 && again.body.payload === ciphertext);

  // ── 错 PIN ──────────────────────────────────────────────────────────
  const wrongPin = await get(`/sync/${code}?pin=0000`);
  check('错 PIN 被拒（403 pin_mismatch）', wrongPin.status === 403 && wrongPin.body.error === 'pin_mismatch');

  // ── 不存在的码 ──────────────────────────────────────────────────────
  const notFound = await get('/sync/000000?pin=0000');
  check('不存在的码 404', notFound.status === 404 && notFound.body.error === 'not_found');

  // ── PUT 覆盖（重新计时）──────────────────────────────────────────────
  const second = await encryptSyncPayload(
    encodeSyncPayload('chunithm', { bests: [] }),
    deriveKeyBase64(PIN, code),
    deriveIvBase64(code),
  );
  const overwritten = await put(`/sync/${code}`, { pin: PIN, payload: second });
  check('PUT 可以覆盖', overwritten.status === 200);

  const afterOverwrite = await get(`/sync/${code}?pin=${PIN}`);
  check('覆盖后拿到新数据', afterOverwrite.body.payload === second);

  // ── 结果 ────────────────────────────────────────────────────────────
  console.log(`\n  通过 ${passed}，失败 ${failed}\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\n  脚本本身出错：', error);
  process.exitCode = 1;
});
