/**
 * 同步载荷解析与落库映射的单元测试。
 *
 * 这段逻辑决定「同步之后 B50 能不能读到」。键名写错的表现是
 * 「同步显示成功，但查分还是空的」——在手表上排查很痛苦，
 * 所以键名要和 pages/B50/b50.ux 里读的完全对上。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { describePayload, parseSyncPayload, storageWritesFor } from '../src/common/sync-payload.js';

test('解析新格式载荷', () => {
  assert.deepEqual(parseSyncPayload('{"kind":"friendCode","value":"123456789012345"}'), {
    kind: 'friendCode',
    value: '123456789012345',
  });
  assert.deepEqual(parseSyncPayload('{"kind":"qq","value":"10001"}'), { kind: 'qq', value: '10001' });
  assert.deepEqual(parseSyncPayload('{"kind":"qr","value":"MAIDATA:abc"}'), { kind: 'qr', value: 'MAIDATA:abc' });
});

test('兼容裸字符串（老格式按好友码处理）', () => {
  assert.deepEqual(parseSyncPayload('123456789012345'), {
    kind: 'friendCode',
    value: '123456789012345',
  });
});

test('纯数字字符串不会被 JSON.parse 骗过去', () => {
  // 这是真踩过的坑：JSON.parse('123456789012345') 会成功并返回 number，
  // 而好友码正好全是数字。当时的表现就是「同步成功但查分还是空的」。
  assert.deepEqual(parseSyncPayload('123456789012345'), {
    kind: 'friendCode',
    value: '123456789012345',
  });
  // 同理，JSON 里的其它标量也不能当载荷
  assert.deepEqual(parseSyncPayload('true'), { kind: 'friendCode', value: 'true' });
  assert.deepEqual(parseSyncPayload('"abc"'), { kind: 'friendCode', value: '"abc"' });
  assert.deepEqual(parseSyncPayload('[]'), { kind: 'friendCode', value: '[]' });
});

test('缺 kind 时默认按好友码处理', () => {
  assert.deepEqual(parseSyncPayload('{"value":"999"}'), { kind: 'friendCode', value: '999' });
});

test('空内容一律返回 null，不产生半个结果', () => {
  assert.equal(parseSyncPayload(''), null);
  assert.equal(parseSyncPayload('   '), null);
  assert.equal(parseSyncPayload('{}'), null);
  assert.equal(parseSyncPayload('{"kind":"qq"}'), null);
  assert.equal(parseSyncPayload('{"kind":"qq","value":""}'), null);
  assert.equal(parseSyncPayload(null), null);
  assert.equal(parseSyncPayload(undefined), null);
});

test('好友码写入的键必须和 B50 读的一致', () => {
  const writes = storageWritesFor({ kind: 'friendCode', value: '123456789012345' });
  assert.deepEqual(writes, [
    { key: 'queryKind', value: 'friendCode' },
    { key: 'queryValue', value: '123456789012345' },
    // 首页读 queryValue 时会兜底读 friendCode，所以好友码要镜像一份
    { key: 'friendCode', value: '123456789012345' },
  ]);
});

test('QQ 号不写 friendCode 镜像', () => {
  const writes = storageWritesFor({ kind: 'qq', value: '10001' });
  assert.deepEqual(writes, [
    { key: 'queryKind', value: 'qq' },
    { key: 'queryValue', value: '10001' },
  ]);
  // 混进好友码镜像会让下次查分用错号
  assert.ok(!writes.some((item) => item.key === 'friendCode'));
});

test('二维码只写 qrInput', () => {
  const writes = storageWritesFor({ kind: 'qr', value: 'MAIDATA:xyz' });
  assert.deepEqual(writes, [{ key: 'qrInput', value: 'MAIDATA:xyz' }]);
  // 二维码不该污染查分目标，否则 B50 会拿一段二维码文本当好友码
  assert.ok(!writes.some((item) => item.key === 'queryValue'));
});

test('未知 kind 退化成好友码而不是写坏数据', () => {
  const writes = storageWritesFor({ kind: 'something-else', value: '123' });
  assert.equal(writes[0].value, 'friendCode');
});

test('空载荷不产生任何写入', () => {
  assert.deepEqual(storageWritesFor(null), []);
  assert.deepEqual(storageWritesFor({ kind: 'qq', value: '' }), []);
});

test('描述文案覆盖三种类型', () => {
  assert.equal(describePayload({ kind: 'friendCode' }), '好友码');
  assert.equal(describePayload({ kind: 'qq' }), 'QQ 号');
  assert.equal(describePayload({ kind: 'qr' }), '玩家二维码');
  assert.equal(describePayload(null), '数据');
});
