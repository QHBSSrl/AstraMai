/**
 * 输入校验（纯函数，可单测）。
 *
 * 手表上没有系统输入法，所有输入都靠端上的自绘键盘，
 * 因此「什么时候算输完了、能不能提交」必须在一个地方定义清楚，
 * 而不是散落在页面的事件处理里。
 */

/**
 * 好友码长度。
 *
 * ⚠️ 这里从「固定 15 位」放宽成了区间，原因是**多游戏**：
 * 舞萌好友码确定是 15 位（一直在用），但中二节奏的好友码长度
 * 我没有实测过。如果写死 15 而中二不是，**整个查分功能会被客户端
 * 自己挡在门外**，而且报错是「应为 15 位数字」，看不出真正原因。
 *
 * 放宽的代价只是「少了即时纠错」——真正的权威是服务端，
 * 长度不对它会返回明确的错误信息。**宁可让服务端拒绝，也不要客户端误挡。**
 */
export const FRIEND_CODE_LENGTH = 15;
export const FRIEND_CODE_MIN_LENGTH = 10;
export const FRIEND_CODE_MAX_LENGTH = 20;
/** QQ 号 5–11 位数字。 */
export const QQ_MIN_LENGTH = 5;
export const QQ_MAX_LENGTH = 11;

/** 查询方式。 */
export const QUERY_KINDS = ['friendCode', 'qq'];

/** 只保留数字；用于过滤键盘输入与粘贴内容。 */
export function normalizeDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** 是否是可以提交的好友码。 */
export function isFriendCode(value) {
  const text = String(value ?? '');
  return (
    /^\d+$/.test(text) &&
    text.length >= FRIEND_CODE_MIN_LENGTH &&
    text.length <= FRIEND_CODE_MAX_LENGTH
  );
}

/** 是否是可以提交的 QQ 号。 */
export function isQq(value) {
  return /^\d{5,11}$/.test(value);
}

/** 该查询方式下的最大输入长度。 */
export function maxLengthOf(kind) {
  return kind === 'qq' ? QQ_MAX_LENGTH : FRIEND_CODE_MAX_LENGTH;
}

/** 该查询方式下，满足条件时的长度列表（用于键盘高亮「可以提交了」）。 */
export function isReadyToSubmit(kind, value) {
  return kind === 'qq' ? isQq(value) : isFriendCode(value);
}

/**
 * 追加一位数字。
 * 超过长度上限时原样返回，避免把输入截断成「看起来对但其实错」的值。
 */
export function appendDigit(kind, value, digit) {
  const next = normalizeDigits(value) + normalizeDigits(digit);
  return next.length > maxLengthOf(kind) ? normalizeDigits(value) : next;
}

/** 删除最后一位。 */
export function backspace(value) {
  const current = normalizeDigits(value);
  return current.slice(0, -1);
}

/**
 * 给用户的即时提示，显示在键盘上方。
 * 返回 `{ text, state }`，state 为 `idle` / `partial` / `ready` / `invalid`。
 */
export function describeInput(kind, value) {
  const current = normalizeDigits(value);
  const max = maxLengthOf(kind);
  const label = kind === 'qq' ? 'QQ 号' : '好友码';

  if (current.length === 0) {
    return { text: `请输入${label}`, state: 'idle' };
  }
  if (isReadyToSubmit(kind, current)) {
    return { text: `${label}已就绪，${current.length} 位`, state: 'ready' };
  }
  if (current.length >= max) {
    return {
      text: kind === 'qq' ? `QQ 号长度应为 ${QQ_MIN_LENGTH}–${QQ_MAX_LENGTH} 位` : `${label}应为 ${max} 位数字`,
      state: 'invalid',
    };
  }
  return { text: `${current.length} / ${max} 位`, state: 'partial' };
}

/** 把保存的值转成可展示的摘要。 */
export function summarizeTarget(kind, value) {
  const current = normalizeDigits(value);
  if (!current) return null;
  const label = kind === 'qq' ? 'QQ' : '好友码';
  return `${label} ${current}`;
}
