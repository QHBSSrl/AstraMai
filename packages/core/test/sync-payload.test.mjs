/**
 * 同步载荷 / 加密参数的测试。
 *
 * ── 这个测试真正在防什么 ────────────────────────────────────────────
 *
 * 数据要在 **手表（Vela @system.crypto）** 和 **浏览器（WebCrypto）**
 * 之间搬。两边的 AES API 长得完全不一样，所以密钥和 IV **必须由
 * 同一个函数推导** —— 就是 `deriveKeyBase64` / `deriveIvBase64`。
 *
 * 于是这里的最重要一条是：**输出必须逐字节固定**。
 * 下面把期望值写死成 base64 字面量 —— 任何人改了推导逻辑，
 * 这些断言会立刻失败，而不是等到真机上解密出乱码才发现。
 *
 * 第二重要的是 **base64 编解码本身**：core 不能依赖 `btoa`（手表上不一定有），
 * 所以是自己实现的。自己实现的 base64 很容易在填充、末尾字节上出错。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KEY_BYTES,
  SYNC_VERSION,
  base64ToBytes,
  bytesToBase64,
  decodeSyncPayload,
  deriveIvBase64,
  deriveKeyBase64,
  encodeSyncPayload,
  isValidCode,
  isValidPin,
} from '../dist/index.js';

// ══════════════════════════════════════════════════════════════════════
// base64（自己实现的，必须和标准一致）
// ══════════════════════════════════════════════════════════════════════

test('base64 编码和 Node 内置的 btoa 一致', () => {
  // 用真实字节样本，覆盖三种填充情况（无填充 / 一个 = / 两个 =）
  const samples = [
    [],
    [0x61],
    [0x61, 0x62],
    [0x61, 0x62, 0x63],
    [0xff, 0x00, 0x80],
    [0x00, 0x00, 0x00],
    Array.from({ length: 16 }, (_, i) => i),
  ];

  for (const bytes of samples) {
    const expected = Buffer.from(bytes).toString('base64');
    assert.equal(bytesToBase64(bytes), expected, `字节 ${bytes.join(',')} 编码不对`);
  }
});

test('base64 解码能还原原字节', () => {
  for (const bytes of [[0x61, 0x62, 0x63], [0xff, 0x00], Array.from({ length: 16 }, (_, i) => i * 3)]) {
    const encoded = bytesToBase64(bytes);
    assert.deepEqual(base64ToBytes(encoded), bytes);
  }
});

test('base64 解码非法字符会抛异常，不静默吞掉', () => {
  assert.throws(() => base64ToBytes('!!!!'));
});

// ══════════════════════════════════════════════════════════════════════
// 校验
// ══════════════════════════════════════════════════════════════════════

test('PIN 必须是 4 位数字', () => {
  assert.equal(isValidPin('1234'), true);
  assert.equal(isValidPin('0000'), true);
  for (const bad of ['123', '12345', 'abcd', '12 4', '', null, undefined, 1234]) {
    assert.equal(isValidPin(bad), false, `${String(bad)} 不该通过`);
  }
});

test('配对码必须是 6 位数字（含前导零）', () => {
  assert.equal(isValidCode('000123'), true);
  for (const bad of ['12345', '1234567', 'abcdef', '', null, 123456]) {
    assert.equal(isValidCode(bad), false, `${String(bad)} 不该通过`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// 密钥 / IV —— **逐字节固定**
// ══════════════════════════════════════════════════════════════════════

test(`密钥是 ${KEY_BYTES} 字节的 base64`, () => {
  const key = deriveKeyBase64('1234', '000123');
  const bytes = base64ToBytes(key);

  assert.equal(bytes.length, KEY_BYTES, '密钥长度不对，AES-128 必须是 16 字节');
  // 24 个 base64 字符 = 16 字节（16 不是 3 的倍数，末尾带一个 =）
  assert.equal(key.length, 24);
});

test('密钥就是 "PIN+配对码" 补零到 16 字节 —— 值写死防改错', () => {
  // "1234" + "000123" = "1234000123"（10 字符）+ 6 个 '0' = "1234000123000000"
  const expected = Buffer.from('1234000123000000', 'ascii').toString('base64');
  assert.equal(deriveKeyBase64('1234', '000123'), expected);
});

test('IV 就是配对码补零到 16 字节 —— 值写死防改错', () => {
  // "000123" + 10 个 '0' = "0001230000000000"
  const expected = Buffer.from('0001230000000000', 'ascii').toString('base64');
  assert.equal(deriveIvBase64('000123'), expected);
});

test('不同 PIN / 不同 code 得到不同密钥', () => {
  const a = deriveKeyBase64('1234', '000123');
  const b = deriveKeyBase64('1235', '000123');
  const c = deriveKeyBase64('1234', '000124');

  assert.notEqual(a, b, 'PIN 变了密钥必须变');
  assert.notEqual(a, c, '配对码变了密钥必须变');
});

test('相同的 PIN + code 每次得到同一把密钥（这是关键：两端必须一致）', () => {
  const first = deriveKeyBase64('9876', '654321');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(deriveKeyBase64('9876', '654321'), first);
  }
});

test('非法 PIN / code 抛异常，不产出坏密钥', () => {
  assert.throws(() => deriveKeyBase64('123', '000123'), /PIN/);
  assert.throws(() => deriveKeyBase64('1234', '12345'), /配对码/);
  assert.throws(() => deriveIvBase64('12345'), /配对码/);
});

// ══════════════════════════════════════════════════════════════════════
// 载荷编解码
// ══════════════════════════════════════════════════════════════════════

test('编码后再解码能还原', () => {
  const view = { player: { rating: 15012 }, standard: [], dx: [] };
  const raw = encodeSyncPayload('maimai', view, new Date('2026-10-24T09:00:00.000Z'));
  const decoded = decodeSyncPayload(raw);

  assert.equal(decoded.version, SYNC_VERSION);
  assert.equal(decoded.game, 'maimai');
  assert.equal(decoded.createdAt, '2026-10-24T09:00:00.000Z');
  assert.deepEqual(decoded.view, view);
});

test('中文和 emoji 能原样往返', () => {
  const view = { title: '舞萌 DX 测试 🎵', names: ['初音ミク', 'テスト'] };
  const decoded = decodeSyncPayload(encodeSyncPayload('maimai', view));
  assert.deepEqual(decoded.view, view);
});

test('版本不对直接拒绝（拿错版本继续用比报错更糟）', () => {
  const raw = JSON.stringify({ version: 999, game: 'maimai', createdAt: '', view: {} });
  assert.throws(() => decodeSyncPayload(raw), /版本/);
});

test('缺字段 / 非 JSON 都抛异常', () => {
  assert.throws(() => decodeSyncPayload('not json'), /JSON/);
  assert.throws(() => decodeSyncPayload('null'), /对象/);
  assert.throws(() => decodeSyncPayload(JSON.stringify({ version: 1 })), /游戏/);
  assert.throws(
    () => decodeSyncPayload(JSON.stringify({ version: 1, game: 'maimai' })),
    /生成时间/,
  );
});

test('view 是什么就原样返回，不做内容校验', () => {
  // 调用方自己决定怎么用 —— core 不假设它是 B50View
  for (const view of [null, 0, '', [], { a: 1 }]) {
    const decoded = decodeSyncPayload(encodeSyncPayload('maimai', view));
    assert.deepEqual(decoded.view, view);
  }
});
