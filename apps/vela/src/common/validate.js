/**
 * 输入校验（纯函数，可单测）。
 *
 * 手表上没有系统输入法，所有输入都靠端上的自绘键盘，
 * 因此「什么时候算输完了、能不能提交」必须在一个地方定义清楚，
 * 而不是散落在页面的事件处理里。
 */

/** 各查询方式的名字，用于选项卡和提示。 */
export const KIND_LABELS = {
  friendCode: '好友码',
  qq: 'QQ 号',
  username: '用户名',
};

/** 摘要里用的短名。 */
export const KIND_SHORT_LABELS = {
  friendCode: '好友码',
  qq: 'QQ',
  username: 'osu!',
};

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
export const QUERY_KINDS = ['friendCode', 'qq', 'username'];

/**
 * osu! 用户名的长度。
 *
 * 官方限制是 2–15 个字符。取 15 作为上限。
 */
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 15;

/**
 * osu! 用户名允许的字符。
 *
 * 官方允许：字母、数字、下划线、连字符、空格、方括号。
 * 不允许中文——**不要「好心」放行**，输错了只会得到一个 404。
 */
const USERNAME_ALLOWED = /[^A-Za-z0-9_\-. [\]]/g;

/** 只保留数字；用于过滤键盘输入与粘贴内容。 */
export function normalizeDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** 过滤掉 osu! 用户名里不允许的字符。 */
export function normalizeUsername(value) {
  return String(value ?? '').replace(USERNAME_ALLOWED, '');
}

/**
 * 按查询方式归一化输入。
 *
 * **所有输入都要经过这里**，不要在调用点各写各的——
 * 之前就是因为「页面对数字归一化、另一个地方没归一化」
 * 导致过一会儿能查一会儿不能查。
 */
export function normalizeByKind(kind, value) {
  return kind === 'username' ? normalizeUsername(value) : normalizeDigits(value);
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

/** 是否是可以提交的 osu! 用户名。 */
export function isUsername(value) {
  const text = String(value ?? '');
  if (text.length < USERNAME_MIN_LENGTH || text.length > USERNAME_MAX_LENGTH) return false;
  // 归一化后必须原样不变——含非法字符的不算「准备好」
  return normalizeUsername(text) === text;
}

/** 该查询方式下的最大输入长度。 */
export function maxLengthOf(kind) {
  if (kind === 'qq') return QQ_MAX_LENGTH;
  if (kind === 'username') return USERNAME_MAX_LENGTH;
  return FRIEND_CODE_MAX_LENGTH;
}

/** 该查询方式下，满足条件时的长度列表（用于键盘高亮「可以提交了」）。 */
export function isReadyToSubmit(kind, value) {
  if (kind === 'qq') return isQq(value);
  if (kind === 'username') return isUsername(value);
  return isFriendCode(value);
}

/**
 * 追加输入。
 *
 * 名字沿用 `appendDigit` 是历史原因——现在它也处理字母了。
 * 超过长度上限时原样返回，避免把输入截断成「看起来对但其实错」的值。
 */
export function appendDigit(kind, value, digit) {
  const next = normalizeByKind(kind, value) + normalizeByKind(kind, digit);
  return next.length > maxLengthOf(kind) ? normalizeByKind(kind, value) : next;
}

/**
 * 删除最后一个字符。
 *
 * 故意**不归一化**：存进来的值本来就应该是归一化过的，
 * 这里再归一化一次会把字母抹掉（用户名场景）。
 */
export function backspace(value) {
  return String(value ?? '').slice(0, -1);
}

/**
 * 给用户的即时提示，显示在键盘上方。
 * 返回 `{ text, state }`，state 为 `idle` / `partial` / `ready` / `invalid`。
 */
export function describeInput(kind, value) {
  const current = normalizeByKind(kind, value);
  const max = maxLengthOf(kind);
  const label = KIND_LABELS[kind] ?? '好友码';

  if (kind === 'username') {
    if (current.length === 0) return { text: '请输入 osu! 用户名', state: 'idle' };
    if (isUsername(current)) {
      return { text: `用户名已就绪，${current.length} 个字符`, state: 'ready' };
    }
    if (current.length >= max) {
      return { text: `用户名应为 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符`, state: 'invalid' };
    }
    return { text: `${current.length} / ${max} 个字符`, state: 'partial' };
  }

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
  const current = normalizeByKind(kind, value);
  if (!current) return null;
  const label = KIND_SHORT_LABELS[kind] ?? '好友码';
  return `${label} ${current}`;
}
