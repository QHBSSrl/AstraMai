/**
 * QR 编码器回归测试。
 *
 * 这些向量是在编码器**通过**「与成熟参考实现（node-qrcode）逐位对比 486 组」
 * 之后固化下来的。它们的作用不是重新证明算法正确，而是：
 *   1. 让仓库在没有第三方依赖时也能跑测试；
 *   2. 任何后续改动导致点阵变化，立刻红灯。
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  alignmentPatternPositions,
  encodeQr,
  encodeQrBytes,
  numDataCodewords,
  parseWahlapQrPayload,
  qrSizeOfVersion,
  qrToBlockArt,
  qrToPathData,
  qrToRgba,
  qrToSvg,
  rawDataModules,
  utf8Decode,
  utf8Encode,
} from '../dist/index.js';

const vectors = JSON.parse(
  readFileSync(new URL('./qr-vectors.json', import.meta.url), 'utf8'),
).vectors;

function textOf(vector) {
  if (vector.literal !== undefined) return vector.literal;
  return vector.repeat.char.repeat(vector.repeat.count);
}

function digestOf(qr) {
  const hash = createHash('sha256');
  hash.update(Buffer.from(qr.modules));
  return hash.digest('hex').slice(0, 32);
}

test('黄金向量：版本、尺寸、深色数、掩码与点阵摘要全部一致', () => {
  assert.ok(vectors.length >= 240, `向量数量偏少：${vectors.length}`);
  let checked = 0;

  for (const vector of vectors) {
    const text = textOf(vector);
    const options = { ecLevel: vector.ecLevel };
    if (vector.mask !== null && vector.mask !== undefined) options.mask = vector.mask;
    if (vector.minVersion !== undefined) options.minVersion = vector.minVersion;
    if (vector.maxVersion !== undefined) options.maxVersion = vector.maxVersion;

    const qr = encodeQr(text, options);
    const label = `${vector.ecLevel} v${vector.version} mask=${vector.mask ?? 'auto'} len=${text.length}`;

    assert.equal(qr.version, vector.version, `${label}: 版本`);
    assert.equal(qr.size, vector.size, `${label}: 边长`);
    assert.equal(qr.darkCount, vector.darkCount, `${label}: 深色模块数`);
    assert.equal(qr.mask, vector.chosenMask, `${label}: 最终掩码`);
    assert.equal(digestOf(qr), vector.digest, `${label}: 点阵摘要`);
    checked += 1;
  }

  assert.equal(checked, vectors.length);
});

test('点阵尺寸与 darkCount 自洽', () => {
  for (const ecLevel of ['L', 'M', 'Q', 'H']) {
    const qr = encodeQr('https://example.com/consistency', { ecLevel });
    assert.equal(qr.modules.length, qr.size * qr.size);
    let dark = 0;
    for (let i = 0; i < qr.modules.length; i += 1) dark += qr.modules[i];
    assert.equal(dark, qr.darkCount);
    // 越界访问应返回 false，而不是抛错
    assert.equal(qr.isDark(-1, 0), false);
    assert.equal(qr.isDark(0, qr.size), false);
  }
});

test('对齐图形位置符合规范', () => {
  assert.deepEqual(alignmentPatternPositions(1), []);
  assert.deepEqual(alignmentPatternPositions(2), [6, 18]);
  assert.deepEqual(alignmentPatternPositions(7), [6, 22, 38]);
  // 版本 32 是规范里步长的特例
  assert.deepEqual(alignmentPatternPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPatternPositions(40), [
    6, 30, 58, 86, 114, 142, 170,
  ]);
});

test('容量表的关键取值与规范一致', () => {
  assert.equal(qrSizeOfVersion(1), 21);
  assert.equal(qrSizeOfVersion(40), 177);
  assert.equal(rawDataModules(1), 208);
  assert.equal(Math.floor(rawDataModules(1) / 8), 26);
  assert.equal(numDataCodewords(1, 'L'), 19);
  assert.equal(numDataCodewords(1, 'M'), 16);
  assert.equal(numDataCodewords(1, 'Q'), 13);
  assert.equal(numDataCodewords(1, 'H'), 9);
  // 版本 40 的总码字数
  assert.equal(Math.floor(rawDataModules(40) / 8), 3706);
});

test('版本 1-M 的字节容量恰为 14', () => {
  assert.doesNotThrow(() => encodeQr('x'.repeat(14), { ecLevel: 'M', maxVersion: 1 }));
  assert.throws(
    () => encodeQr('x'.repeat(15), { ecLevel: 'M', maxVersion: 1 }),
    /数据太长/,
  );
});

test('参数校验', () => {
  assert.throws(() => encodeQr('x', { minVersion: 41 }), RangeError);
  assert.throws(() => encodeQr('x', { maxVersion: 0 }), RangeError);
  assert.throws(() => encodeQr('x', { minVersion: 10, maxVersion: 5 }), RangeError);
  assert.throws(() => encodeQr('x', { mask: 8 }), RangeError);
  assert.throws(() => encodeQr('x', { mask: -1 }), RangeError);
  assert.throws(() => encodeQr('x'.repeat(4000), { ecLevel: 'H' }), /数据太长/);
});

test('encodeQrBytes 与 encodeQr 对同一字节序列结果一致', () => {
  const text = '舞萌DX / 中二节奏 登入二维码';
  const bytes = utf8Encode(text);
  const a = encodeQr(text, { ecLevel: 'Q' });
  const b = encodeQrBytes(bytes, { ecLevel: 'Q' });
  assert.equal(a.version, b.version);
  assert.equal(a.mask, b.mask);
  assert.deepEqual(Array.from(a.modules), Array.from(b.modules));
});

test('UTF-8 编解码可往返，且非法输入降级为替换字符', () => {
  const samples = ['', 'ascii', '中文', '𝄞 代理对', '🎵🎮', 'mixed 混排 abc 123'];
  for (const sample of samples) {
    assert.equal(utf8Decode(utf8Encode(sample)), sample, `往返失败：${sample}`);
  }
  // 孤立的高代理项 → U+FFFD
  assert.equal(utf8Decode(utf8Encode('\uD83C')), '\uFFFD');
  // 过长编码应被拒绝
  assert.equal(utf8Decode([0xc0, 0xaf]), '\uFFFD\uFFFD');
  // 越界的前导字节，以及后面每个落单的延续字节各算一个替换字符
  assert.equal(utf8Decode([0xf5, 0x80, 0x80, 0x80]), '\uFFFD\uFFFD\uFFFD\uFFFD');
});

test('点阵含正确的定位图形', () => {
  const qr = encodeQr('finder', { ecLevel: 'L' });
  const expected = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (const [originRow, originCol] of [
    [0, 0],
    [0, qr.size - 7],
    [qr.size - 7, 0],
  ]) {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        assert.equal(
          qr.isDark(originRow + r, originCol + c) ? 1 : 0,
          expected[r][c],
          `定位图形 (${originRow + r},${originCol + c})`,
        );
      }
    }
  }
  // 定位图形与数据区之间的分隔符必须是浅色
  for (let i = 0; i < 8; i += 1) {
    assert.equal(qr.isDark(7, i), false, `分隔符 (7,${i})`);
    assert.equal(qr.isDark(i, 7), false, `分隔符 (${i},7)`);
  }
  // 固定的深色模块
  assert.equal(qr.isDark(qr.size - 8, 8), true);
});

test('渲染辅助输出形状正确', () => {
  const qr = encodeQr('https://example.com/render', { ecLevel: 'M' });

  const path = qrToPathData(qr, 4);
  assert.match(path, /^M\d+ \d+h\d+v1h-\d+z/);
  assert.ok(path.length > 0);

  const svg = qrToSvg(qr, { moduleSize: 5, quietZone: 4, dark: '#111', light: '#eee' });
  const expectedSide = (qr.size + 8) * 5;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`width="${expectedSide}"`));
  assert.ok(svg.includes(`viewBox="0 0 ${expectedSide} ${expectedSide}"`));
  assert.ok(svg.includes('fill="#111"'));
  assert.ok(svg.includes('fill="#eee"'));
  assert.ok(svg.endsWith('</svg>'));

  const transparent = qrToSvg(qr, { light: 'transparent' });
  assert.ok(!transparent.includes('<rect'));

  const rgba = qrToRgba(qr, 3, { quietZone: 2 });
  const side = (qr.size + 4) * 3;
  assert.equal(rgba.width, side);
  assert.equal(rgba.height, side);
  assert.equal(rgba.data.length, side * side * 4);
  // 静区左上角必须是浅色
  assert.deepEqual(Array.from(rgba.data.slice(0, 4)), [255, 255, 255, 255]);

  const art = qrToBlockArt(qr, { quietZone: 1 });
  const lines = art.split('\n');
  assert.equal(lines.length, qr.size + 2);
});

test('相同输入必须得到完全相同的结果（可复现）', () => {
  const text = 'https://wq.wahlap.net/qrcode/req/MAIDexample.html?l=1&t=41&d=42';
  const first = encodeQr(text, { ecLevel: 'M' });
  const second = encodeQr(text, { ecLevel: 'M' });
  assert.equal(digestOf(first), digestOf(second));
  assert.equal(first.mask, second.mask);
});

// ══════════════════════════════════════════════════════════════════════
// 真实样例（2026-10-24 从华立页面抓的）
// ══════════════════════════════════════════════════════════════════════

/**
 * 华立登录二维码的**真实**样例。
 *
 * 抓这条是因为用户报「华立好像改了二维码页面的逻辑」——
 * 拿真数据验一遍比读代码可靠。结论：**格式没变**。
 *
 * 这条同时覆盖了几个容易出错的点：
 *   · URL 里的 `l` 是**十进制秒**，不是 hex
 *   · `t` / `d` 是 **hex 编码的 UTF-8**，不是百分号编码
 *   · 路径里是 `MAID...`，而二维码内容是 `SGWC` + `MAID...`
 *   · 时间戳藏在 id 里（`261024190635` = 26-10-24 19:06:35）
 */
const REAL_URL =
  'https://wq.wahlap.net/qrcode/req/MAID261024190635A885B648BD4982F5C6723923998CD5F0B235DEF851881170EC396CCEADD6219B.html' +
  '?l=1792840595' +
  '&t=E8889EE8908C4458202F20E4B8ADE4BA8CE88A82E5A58F20E799BBE585A5E4BA8CE7BBB4E7A081' +
  '&d=E68A8AE4B88BE696B9E4BA8CE7BBB4E7A081E5AFB9E58786E69CBAE58FB0E689ABE68F8FE5A484EFBC8CE58FAFE794A8E69CBAE58FB0E69C89E38090E8889EE8908C4458E38091E5928CE38090E4B8ADE4BA8CE88A82E5A58FE38091';

const REAL_CONTENT =
  'SGWCMAID261024190635A885B648BD4982F5C6723923998CD5F0B235DEF851881170EC396CCEADD6219B';

test('真实 URL：字段全解析对', () => {
  const parsed = parseWahlapQrPayload(REAL_URL);

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.source, 'html-url');
  assert.equal(parsed.host, 'wq.wahlap.net');
  assert.equal(parsed.content, REAL_CONTENT);
  assert.equal(parsed.machinePrefix, 'MAID');
  assert.equal(parsed.contentPrefix, 'SGWC');

  // 标题和描述是 hex 编码的 UTF-8，解出来必须是正常中文
  assert.equal(parsed.title, '舞萌DX / 中二节奏 登入二维码');
  assert.equal(parsed.description, '把下方二维码对准机台扫描处，可用机台有【舞萌DX】和【中二节奏】');
});

test('真实 URL：有效期正好 10 分钟', () => {
  const parsed = parseWahlapQrPayload(REAL_URL);

  // id 里带生成时间：261024190635 = 2026-10-24 19:06:35 (+08:00)
  assert.equal(parsed.generatedAt.toISOString(), '2026-10-24T11:06:35.000Z');
  // l=1792840595 是十进制的过期时间，不是 hex
  assert.equal(parsed.expiresAt.toISOString(), '2026-10-24T11:16:35.000Z');
  assert.equal(parsed.validForMs, 10 * 60 * 1000);
});

test('真实二维码内容：能从内容反推出同一份信息', () => {
  const parsed = parseWahlapQrPayload(REAL_CONTENT);

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.source, 'content');
  assert.equal(parsed.id, 'MAID261024190635A885B648BD4982F5C6723923998CD5F0B235DEF851881170EC396CCEADD6219B');
  assert.equal(parsed.generatedAt.toISOString(), '2026-10-24T11:06:35.000Z');
  // 纯内容里没有过期时间 —— 那个只在 URL 上
  assert.equal(parsed.expiresAt, null);
});

test('URL 和它的二维码内容互相能对上', () => {
  const fromUrl = parseWahlapQrPayload(REAL_URL);
  const fromContent = parseWahlapQrPayload(REAL_CONTENT);

  assert.equal(fromUrl.content, fromContent.content);
  assert.equal(fromUrl.id, fromContent.id);
  assert.equal(fromUrl.generatedAt.getTime(), fromContent.generatedAt.getTime());
  assert.equal(fromUrl.tokenPreview, fromContent.tokenPreview);
});
