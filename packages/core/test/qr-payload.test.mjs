/**
 * 华立机台二维码载荷解析测试。
 *
 * 样本里的时间戳与令牌都是**合成的**，与任何真实账号或真实二维码无关。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bytesToHex,
  decodeHexUtf8,
  describeValidity,
  formatDuration,
  hexToBytes,
  parseWahlapQrPayload,
} from '../dist/index.js';

const TOKEN = '0123456789ABCDEF'.repeat(4);
const TITLE_HEX = 'E8889EE8908C4458202F20E4B8ADE4BA8CE88A82E5A58F20E799BBE585A5E4BA8CE7BBB4E7A081';
const DESC_HEX =
  'E68A8AE4B88B' +
  'E696B9E4BA8CE7BBB4E7A081E5AFB9E58786E69CBAE58FB0E689ABE68F8FE5A484EFBC8CE58FAFE794A8E69CBAE58FB0E69C89E38090E8889EE8908C4458E38091E5928CE38090E4B8ADE4BA8CE88A82E5A58FE38091';

/** 文件名时间戳 240101120000 = 北京时间 2024-01-01 12:00:00。 */
const GENERATED_UTC_MS = Date.UTC(2024, 0, 1, 4, 0, 0);
/** l = 北京时间 2024-01-01 12:10:00，即生成后 10 分钟。 */
const EXPIRES_UTC_MS = Date.UTC(2024, 0, 1, 4, 10, 0);

const SAMPLE = `https://wq.wahlap.net/qrcode/req/MAID240101120000${TOKEN}.html?l=${EXPIRES_UTC_MS / 1000}&t=${TITLE_HEX}&d=${DESC_HEX}`;

test('解析真实形状的机台登入二维码', () => {
  const payload = parseWahlapQrPayload(SAMPLE);
  assert.ok(payload);
  assert.equal(payload.host, 'wq.wahlap.net');
  assert.equal(payload.kind, 'login');
  assert.equal(payload.recognized, true);
  assert.equal(payload.prefix, 'MAID');

  // 文件名里的时间戳按北京时间解释：这组断言与时区无关
  assert.ok(payload.generatedAt instanceof Date);
  assert.equal(payload.generatedAt.getTime(), GENERATED_UTC_MS);
  assert.equal(payload.expiresAt.getTime(), EXPIRES_UTC_MS);
  assert.equal(payload.validForMs, 10 * 60 * 1000);

  assert.equal(payload.title, '舞萌DX / 中二节奏 登入二维码');
  assert.equal(
    payload.description,
    '把下方二维码对准机台扫描处，可用机台有【舞萌DX】和【中二节奏】',
  );

  // 令牌摘要必须截断，不能是完整令牌
  assert.ok(payload.tokenPreview.startsWith('012345'));
  assert.ok(payload.tokenPreview.includes('(64)'));
  assert.ok(!payload.tokenPreview.includes(TOKEN));
});

test('有效期判定随时间变化', () => {
  const payload = parseWahlapQrPayload(SAMPLE);
  const before = new Date(payload.expiresAt.getTime() - 90_000);
  const after = new Date(payload.expiresAt.getTime() + 1_000);

  const valid = describeValidity(payload, before);
  assert.equal(valid.state, 'valid');
  assert.equal(valid.remainingMs, 90_000);
  assert.match(valid.text, /剩余有效时间 1 分 30 秒/);

  const expired = describeValidity(payload, after);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.remainingMs, 0);
  assert.match(expired.text, /已过期/);
});

test('无法判断时返回 unknown 而不是抛错', () => {
  const payload = parseWahlapQrPayload(
    'https://wq.wahlap.net/qrcode/req/MAID240101120000' + TOKEN + '.html',
  );
  assert.ok(payload);
  assert.equal(payload.expiresAt, null);
  assert.equal(describeValidity(payload).state, 'unknown');
});

test('时长格式化', () => {
  assert.equal(formatDuration(0), '0 秒');
  assert.equal(formatDuration(45_000), '45 秒');
  assert.equal(formatDuration(90_000), '1 分 30 秒');
  assert.equal(formatDuration(600_000), '10 分 0 秒');
  assert.equal(formatDuration(-5000), '0 秒');
});

test('非华立链接不会被误判', () => {
  const payload = parseWahlapQrPayload('https://example.com/qrcode/req/MAID123.html?l=1');
  assert.ok(payload);
  assert.equal(payload.recognized, false);
  assert.equal(payload.kind, 'unknown');
});

test('非 URL 输入返回 null', () => {
  assert.equal(parseWahlapQrPayload(''), null);
  assert.equal(parseWahlapQrPayload('not a url'), null);
  assert.equal(parseWahlapQrPayload('ftp://wq.wahlap.net/x'), null);
});

test('畸形参数不影响解析', () => {
  const payload = parseWahlapQrPayload(
    'https://wq.wahlap.net/qrcode/req/MAID240101120000' + TOKEN + '.html?l=abc&t=zz&d=',
  );
  assert.ok(payload);
  assert.equal(payload.expiresAt, null);
  assert.equal(payload.title, null);
  assert.equal(payload.description, null);
});

test('文件名时间戳非法时不猜', () => {
  const payload = parseWahlapQrPayload(
    'https://wq.wahlap.net/qrcode/req/MAID249999120000' + TOKEN + '.html?l=1704082200',
  );
  assert.ok(payload);
  assert.equal(payload.generatedAt, null);
  assert.equal(payload.validForMs, null);
  // 过期时刻仍然解析得出来，只是算不出时长
  assert.equal(payload.expiresAt.getTime(), 1704082200000);
});

test('十六进制工具', () => {
  assert.deepEqual(hexToBytes('4d41'), [0x4d, 0x41]);
  assert.equal(hexToBytes('4d4'), null); // 奇数长度
  assert.equal(hexToBytes(''), null);
  assert.equal(hexToBytes('zz'), null);
  assert.equal(bytesToHex([0x00, 0x0f, 0xff]), '000fff');
  assert.equal(decodeHexUtf8(TITLE_HEX), '舞萌DX / 中二节奏 登入二维码');
  assert.equal(decodeHexUtf8('ff'), null); // 非法 UTF-8
});
