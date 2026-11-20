/**
 * 设备密钥相关逻辑的单元测试。
 *
 * 这是整个配对方案的安全核心：**读取数据时必须出示它，而且它永远不出设备**。
 * 上送服务端的只是它的 SHA256，所以就算有人猜中 8 位配对码也读不走数据。
 *
 * 测的重点是两个平台不确定点（都在真机上极难排查）：
 *   1. `hashDigest` 的返回格式文档没写死，可能是 hex 也可能是 base64
 *   2. `@system.crypto` 未必存在，拿不到时必须安全退化而不是抛错
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDigest } from '../src/common/secret.js';

/** 一个已知的 SHA256：SHA256("hello") */
const HELLO_HEX = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
/** 同一摘要的 base64 形式 */
const HELLO_BASE64 = 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=';

/** 用 Node 自带的 Buffer 冒充 @system.crypto 的 atob。 */
const atob = (text) => Buffer.from(text, 'base64').toString('binary');

test('十六进制摘要原样返回并转小写', () => {
  assert.equal(normalizeDigest(HELLO_HEX, atob), HELLO_HEX);
  assert.equal(normalizeDigest(HELLO_HEX.toUpperCase(), atob), HELLO_HEX);
});

test('base64 摘要会被解码成十六进制', () => {
  // 这条很关键：文档没写死格式，如果平台返回 base64 而我们只认 hex，
  // 表现就是「服务端一直说 deviceSecretHash 格式不对」，在手表上几乎没法查。
  assert.equal(normalizeDigest(HELLO_BASE64, atob), HELLO_HEX);
});

test('没有 atob 时 base64 只能放弃，不能瞎猜', () => {
  assert.equal(normalizeDigest(HELLO_BASE64, undefined), '');
});

test('认不出来的格式一律返回空串，而不是半个结果', () => {
  assert.equal(normalizeDigest('', atob), '');
  assert.equal(normalizeDigest('too-short', atob), '');
  assert.equal(normalizeDigest('z'.repeat(64), atob), '', '非十六进制字符不算数');
  assert.equal(normalizeDigest(null, atob), '');
  assert.equal(normalizeDigest(undefined, atob), '');
  assert.equal(normalizeDigest(12345, atob), '');
  assert.equal(normalizeDigest({}, atob), '');
});

test('长度不对的十六进制不算数', () => {
  assert.equal(normalizeDigest(HELLO_HEX.slice(0, 63), atob), '');
  assert.equal(normalizeDigest(`${HELLO_HEX}0`, atob), '');
});

test('atob 抛错时安全返回空串', () => {
  const throwing = () => {
    throw new Error('boom');
  };
  assert.equal(normalizeDigest(HELLO_BASE64, throwing), '');
});

test('atob 返回垃圾时不产生非法十六进制', () => {
  // 解出来长度不对，应当被长度校验挡住
  assert.equal(normalizeDigest(HELLO_BASE64, () => 'short'), '');
});
