/**
 * 华立机台二维码载荷解析测试。
 *
 * 样本里的时间戳与令牌都是**合成的**，与任何真实账号或真实二维码无关。
 * 但结构、长度、编码参数都按实测的官方数据对齐，见下面 OFFICIAL_* 常量。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WAHLAP_QR_CONTENT_PREFIX,
  bytesToHex,
  decodeHexUtf8,
  describeValidity,
  encodeQr,
  formatDuration,
  hexToBytes,
  parseWahlapQrPayload,
  wahlapQrContentOf,
} from '../dist/index.js';

const TOKEN = '0123456789ABCDEF'.repeat(4);
const ID = `MAID240101120000${TOKEN}`;
const CONTENT = `${WAHLAP_QR_CONTENT_PREFIX}${ID}`;

const TITLE_HEX = 'E8889EE8908C4458202F20E4B8ADE4BA8CE88A82E5A58F20E799BBE585A5E4BA8CE7BBB4E7A081';
const DESC_HEX =
  'E68A8AE4B88B' +
  'E696B9E4BA8CE7BBB4E7A081E5AFB9E58786E69CBAE58FB0E689ABE68F8FE5A484EFBC8CE58FAFE794A8E69CBAE58FB0E69C89E38090E8889EE8908C4458E38091E5928CE38090E4B8ADE4BA8CE88A82E5A58FE38091';

/** 文件名时间戳 240101120000 = 北京时间 2024-01-01 12:00:00。 */
const GENERATED_UTC_MS = Date.UTC(2024, 0, 1, 4, 0, 0);
/** l = 北京时间 2024-01-01 12:10:00，即生成后 10 分钟。 */
const EXPIRES_UTC_MS = Date.UTC(2024, 0, 1, 4, 10, 0);

const HTML_URL = `https://wq.wahlap.net/qrcode/req/${ID}.html?l=${EXPIRES_UTC_MS / 1000}&t=${TITLE_HEX}&d=${DESC_HEX}`;
const PNG_URL = `https://wq.wahlap.net/qrcode/img/${ID}.png?v=`;

/**
 * 实测的官方参数，作为回归基准。
 * 来源：解码官方的 .png（jsQR），解码器报告 version=4，
 * 图像 200×200、码区 198×198、每模块 6px、静区仅 1px。
 */
const OFFICIAL = {
  contentLength: 84,
  version: 4,
  moduleCount: 33,
};

test('三种形态都能还原出同一个二维码内容', () => {
  const fromHtml = parseWahlapQrPayload(HTML_URL);
  const fromPng = parseWahlapQrPayload(PNG_URL);
  const fromContent = parseWahlapQrPayload(CONTENT);
  const fromBareId = parseWahlapQrPayload(ID); // 不带前缀也应当接受

  for (const payload of [fromHtml, fromPng, fromContent, fromBareId]) {
    assert.ok(payload, '解析失败');
    assert.equal(payload.content, CONTENT);
    assert.equal(payload.id, ID);
    assert.equal(payload.machinePrefix, 'MAID');
    assert.equal(payload.contentPrefix, WAHLAP_QR_CONTENT_PREFIX);
    assert.equal(payload.recognized, true);
  }

  assert.equal(fromHtml.source, 'html-url');
  assert.equal(fromPng.source, 'png-url');
  assert.equal(fromContent.source, 'content');

  assert.equal(wahlapQrContentOf(HTML_URL), CONTENT);
  assert.equal(wahlapQrContentOf(PNG_URL), CONTENT);
});

test('二维码内容的长度与结构符合实测', () => {
  const payload = parseWahlapQrPayload(CONTENT);
  assert.equal(payload.content.length, OFFICIAL.contentLength);
  assert.ok(/^SGWC[A-Z]{2,8}\d{12}[0-9A-F]+$/.test(payload.content));
  assert.equal(payload.tokenPreview, '012345…CDEF(64)');
});

test('二维码内容应当编成小尺寸的码——这是手表能用的前提', () => {
  // 这条断言是防回归的关键：如果谁把几百字符的展示页 URL 拿去生成二维码，
  // 这里会立刻红灯。实测官方是版本 4 / 33×33；
  // 本工程是字节模式（官方用字母数字模式），因此版本 5 / 37×37。
  const payload = parseWahlapQrPayload(HTML_URL);
  const qr = encodeQr(payload.content, { ecLevel: 'M' });

  assert.equal(qr.version, 5, `字节模式下应为版本 5，实际 ${qr.version}`);
  assert.equal(qr.size, 37);
  assert.ok(qr.version <= 6, `版本 ${qr.version} 过大，手表上会看不清`);

  // 作为对照：误用展示页 URL 会得到一张大得多的码
  const wrong = encodeQr(HTML_URL, { ecLevel: 'M' });
  assert.ok(
    wrong.version >= 13,
    `误用 URL 应当得到大码，实际版本 ${wrong.version}`,
  );
  assert.equal(wrong.size, wrong.version * 4 + 17);
  assert.ok(
    wrong.size >= 69,
    `误用 URL 的边长 ${wrong.size} 应当远大于正确内容的 ${qr.size}`,
  );
});

test('.html 形态带时效与文案，其余形态没有', () => {
  const html = parseWahlapQrPayload(HTML_URL);
  assert.equal(html.generatedAt.getTime(), GENERATED_UTC_MS);
  assert.equal(html.expiresAt.getTime(), EXPIRES_UTC_MS);
  assert.equal(html.validForMs, 10 * 60 * 1000);
  assert.equal(html.title, '舞萌DX / 中二节奏 登入二维码');
  assert.equal(
    html.description,
    '把下方二维码对准机台扫描处，可用机台有【舞萌DX】和【中二节奏】',
  );

  for (const input of [PNG_URL, CONTENT]) {
    const payload = parseWahlapQrPayload(input);
    assert.equal(payload.generatedAt.getTime(), GENERATED_UTC_MS, '生成时刻仍可解析');
    assert.equal(payload.expiresAt, null, '这两种形态没有 l 参数');
    assert.equal(payload.validForMs, null);
    assert.equal(payload.title, null);
  }
});

test('有效期判定：有 l 才给倒计时，否则老实说不知道', () => {
  const html = parseWahlapQrPayload(HTML_URL);
  const valid = describeValidity(html, new Date(EXPIRES_UTC_MS - 90_000));
  assert.equal(valid.state, 'valid');
  assert.equal(valid.remainingMs, 90_000);
  assert.match(valid.text, /剩余有效时间 1 分 30 秒/);

  const expired = describeValidity(html, new Date(EXPIRES_UTC_MS + 1_000));
  assert.equal(expired.state, 'expired');
  assert.match(expired.text, /已过期/);

  // 不带 l 的形态：不猜
  const png = parseWahlapQrPayload(PNG_URL);
  const unknown = describeValidity(png);
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.remainingMs, null);
  assert.match(unknown.text, /无法判断有效期/);
});

test('时长格式化', () => {
  assert.equal(formatDuration(0), '0 秒');
  assert.equal(formatDuration(45_000), '45 秒');
  assert.equal(formatDuration(90_000), '1 分 30 秒');
  assert.equal(formatDuration(600_000), '10 分 0 秒');
  assert.equal(formatDuration(-5000), '0 秒');
});

test('非华立链接不会被误判为机台二维码', () => {
  const payload = parseWahlapQrPayload('https://example.com/qrcode/req/MAID240101120000.png');
  assert.ok(payload);
  assert.equal(payload.recognized, false);
  assert.equal(payload.source, 'unknown-url');
  assert.equal(payload.content, null);
});

test('无法识别的输入返回 null', () => {
  assert.equal(parseWahlapQrPayload(''), null);
  assert.equal(parseWahlapQrPayload('   '), null);
  assert.equal(parseWahlapQrPayload('not a url nor a qr content'), null);
  assert.equal(parseWahlapQrPayload('ftp://wq.wahlap.net/qrcode/req/x.html'), null);
  assert.equal(parseWahlapQrPayload('MAID12345'), null); // 时间戳位数不对
});

test('畸形参数不影响整体解析', () => {
  const payload = parseWahlapQrPayload(
    `https://wq.wahlap.net/qrcode/req/${ID}.html?l=abc&t=zz&d=`,
  );
  assert.ok(payload);
  assert.equal(payload.content, CONTENT);
  assert.equal(payload.expiresAt, null);
  assert.equal(payload.title, null);
  assert.equal(payload.description, null);
});

test('文件名时间戳非法时不猜', () => {
  const payload = parseWahlapQrPayload(
    `https://wq.wahlap.net/qrcode/req/MAID249999120000${TOKEN}.html?l=${EXPIRES_UTC_MS / 1000}`,
  );
  assert.ok(payload);
  assert.equal(payload.generatedAt, null);
  assert.equal(payload.validForMs, null);
  assert.equal(payload.expiresAt.getTime(), EXPIRES_UTC_MS);
});

test('十六进制工具', () => {
  assert.deepEqual(hexToBytes('4d41'), [0x4d, 0x41]);
  assert.equal(hexToBytes('4d4'), null);
  assert.equal(hexToBytes(''), null);
  assert.equal(hexToBytes('zz'), null);
  assert.equal(bytesToHex([0x00, 0x0f, 0xff]), '000fff');
  assert.equal(decodeHexUtf8(TITLE_HEX), '舞萌DX / 中二节奏 登入二维码');
  assert.equal(decodeHexUtf8('ff'), null);
});
