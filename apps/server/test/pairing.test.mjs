/**
 * 设备配对的单元测试。
 *
 * 这一层的价值全在**安全边界**上，所以测的重点不是 happy path，而是：
 *   - 只凭 token 能不能读走数据（不能）
 *   - 设备密钥不对能不能读走（不能）
 *   - 开了 PIN 之后不带/带错 PIN 能不能写（不能）
 *   - 消费之后数据是不是真的没了
 *   - 爆破防护有没有生效
 *
 * token 只有 8 位十进制（10^8），不限速是可以爆破的，所以失败计数必须有测试守着。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PairingService, sha256Hex } from '../dist/pairing.js';

/** 造一个设备密钥（原文 + 哈希），模拟手表侧。 */
function makeDevice() {
  const secret = `secret-${Math.random().toString(36).slice(2)}`;
  return { secret, hash: sha256Hex(secret) };
}

test('正常流程：start → submit → poll → consume', () => {
  const pairing = new PairingService();
  const device = makeDevice();

  const session = pairing.start(device.hash);
  assert.match(session.token, /^\d{8}$/, 'token 必须是 8 位数字');

  assert.deepEqual(pairing.submit(session.token, 'QQ:123'), { ok: true, pinSet: false });
  assert.deepEqual(pairing.poll(session.token, device.secret), {
    status: 'ready',
    payload: 'QQ:123',
    expiresAt: session.expiresAt,
  });

  assert.equal(pairing.consume(session.token, device.secret), true);
  assert.deepEqual(pairing.poll(session.token, device.secret), { status: 'expired' });
});

test('消费之后数据确实没了（玩家的明确诉求）', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);
  pairing.submit(session.token, 'SECRET');

  pairing.consume(session.token, device.secret);

  // 换个说法再查一遍：不能只是 poll 说 expired，submit 也必须找不到
  assert.equal(pairing.get(session.token), null);
  assert.equal(pairing.submit(session.token, 'again').ok, false);
});

test('只凭 token 读不走数据——必须有设备密钥', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);
  pairing.submit(session.token, 'SECRET');

  assert.deepEqual(pairing.poll(session.token, ''), { status: 'expired' });
});

test('设备密钥不对也读不走', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);
  pairing.submit(session.token, 'SECRET');

  assert.deepEqual(pairing.poll(session.token, 'wrong-secret'), { status: 'expired' });
  // 正确的那把仍然能读
  assert.equal(pairing.poll(session.token, device.secret).status, 'ready');
});

test('别的设备的密钥读不走这台设备的数据', () => {
  const pairing = new PairingService();
  const mine = makeDevice();
  const other = makeDevice();
  const session = pairing.start(mine.hash);
  pairing.submit(session.token, 'SECRET');

  assert.deepEqual(pairing.poll(session.token, other.secret), { status: 'expired' });
});

test('可选 2FA：首次带 PIN 即开启，之后提交必须带对', () => {
  const pairing = new PairingService();
  const device = makeDevice();

  const first = pairing.start(device.hash);
  assert.deepEqual(pairing.submit(first.token, 'A', '1234'), { ok: true, pinSet: true });
  assert.equal(pairing.hasPin(first.token), true);

  const second = pairing.start(device.hash);
  assert.equal(pairing.submit(second.token, 'B').ok, false);
  assert.equal(pairing.submit(second.token, 'B').error, 'pin-required');
  assert.equal(pairing.submit(second.token, 'B', '9999').error, 'pin-wrong');
  assert.equal(pairing.submit(second.token, 'B', '1234').ok, true);
});

test('PIN 和设备绑在一起——换设备不继承', () => {
  const pairing = new PairingService();
  const a = makeDevice();
  const b = makeDevice();

  const sa = pairing.start(a.hash);
  pairing.submit(sa.token, 'A', '1234');

  // 另一台设备没设过 PIN，不该被要求输入
  const sb = pairing.start(b.hash);
  assert.equal(pairing.submit(sb.token, 'B').ok, true);
});

test('PIN 格式不对不算开启 2FA', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);

  assert.equal(pairing.submit(session.token, 'A', 'abc').error, 'pin-wrong');
  assert.equal(pairing.hasPin(session.token), false, '没设成功就不该标记为已开启');
});

test('PIN 不会以明文存进会话', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);
  pairing.submit(session.token, 'A', '1234');

  // 整个会话对象序列化出来都不该出现明文 PIN
  assert.ok(!JSON.stringify(session).includes('1234'));
});

test('爆破防护：连续失败到上限后 token 作废', () => {
  const pairing = new PairingService();
  const device = makeDevice();

  // 先真的设一个 PIN——否则传任意值都会被当成「首次设置 PIN」而成功，
  // 失败计数根本不会涨（我第一版测试就踩了这个）。
  const setup = pairing.start(device.hash);
  pairing.submit(setup.token, 'x', '1234');

  const session = pairing.start(device.hash);
  let lastError = '';
  for (let i = 0; i < 6; i += 1) {
    const result = pairing.submit(session.token, 'x', '0000');
    lastError = result.ok ? '' : result.error;
  }
  assert.equal(lastError, 'too-many-failures');
  assert.equal(pairing.get(session.token), null, '作废后 token 应当从表里消失');

  // 而且用正确的 PIN 也救不回来——已经作废了
  assert.equal(pairing.submit(session.token, 'x', '1234').ok, false);
});

test('爆破防护：正确 PIN 会把失败计数清零', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const setup = pairing.start(device.hash);
  pairing.submit(setup.token, 'x', '1234');

  const session = pairing.start(device.hash);
  // 试错 4 次（不到上限 5）
  for (let i = 0; i < 4; i += 1) pairing.submit(session.token, 'x', '0000');
  assert.equal(pairing.submit(session.token, 'x', '1234').ok, true, '正确 PIN 应当成功');
  // 清零之后再错 4 次也不该作废
  for (let i = 0; i < 4; i += 1) pairing.submit(session.token, 'x', '0000');
  assert.notEqual(pairing.submit(session.token, 'x', '9999').error, 'too-many-failures');
});

test('爆破防护：设备密钥错的次数多了也会作废', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);

  for (let i = 0; i < 6; i += 1) pairing.poll(session.token, 'wrong');

  // 作废之后连正确的密钥都读不到（token 已经没了）
  assert.equal(pairing.get(session.token), null);
  assert.deepEqual(pairing.poll(session.token, device.secret), { status: 'expired' });
});

test('token 不重复', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) tokens.add(pairing.start(device.hash).token);
  assert.equal(tokens.size, 200, '200 次 start 应当产生 200 个不同的 token');
});

test('不存在的 token 一律拒绝', () => {
  const pairing = new PairingService();
  assert.equal(pairing.submit('00000000', 'x').error, 'not-found');
  assert.deepEqual(pairing.poll('00000000', 'whatever'), { status: 'expired' });
  assert.equal(pairing.consume('00000000', 'whatever'), false);
});

test('未提交时 poll 返回 waiting 而不是报错', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);

  const result = pairing.poll(session.token, device.secret);
  assert.equal(result.status, 'waiting');
  assert.equal(result.expiresAt, session.expiresAt);
});

test('统计信息只暴露数量，不泄露内容', () => {
  const pairing = new PairingService();
  const device = makeDevice();
  const session = pairing.start(device.hash);
  pairing.submit(session.token, 'SECRET', '1234');

  const stats = pairing.stats();
  assert.deepEqual(Object.keys(stats).sort(), ['pinnedDevices', 'sessions']);
  assert.ok(!JSON.stringify(stats).includes('SECRET'));
});
