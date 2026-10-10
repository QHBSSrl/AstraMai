/**
 * 同步过来的数据 → 本地存储键。
 *
 * 单独抽出来是有原因的：这段逻辑决定了**同步之后 B50 页面能不能真的读到**。
 * 键名写错了，表现是「同步成功但查分还是空的」——在手表上排查很痛苦。
 * 抽成纯函数就能在 Node 里对着真实的键名做测试。
 *
 * 键名必须和 B50 / 首页读的一致（见 pages/B50/b50.ux 的 restore 与 save）：
 *   queryKind   'friendCode' | 'qq'
 *   queryValue  码本身
 *   friendCode  好友码的镜像（首页会读它做兜底）
 *   qrInput     二维码原始文本
 */

/** 数据类型 → 给用户看的中文名。 */
export const KIND_LABELS = {
  friendCode: '好友码',
  qq: 'QQ 号',
  qr: '玩家二维码',
};

/**
 * 解析手表收到的载荷。
 *
 * 兼容两种形态：
 *   - 新格式：`{"kind":"friendCode","value":"123..."}`
 *   - 老/兜底：裸字符串，按好友码处理
 *
 * 返回 null 表示内容不可用（调用方据此提示，而不是写进一堆空值）。
 */
export function parseSyncPayload(raw) {
  if (raw === null || raw === undefined) return null;

  let parsed = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const candidate = JSON.parse(trimmed);
      // ⚠️ 这里踩过一次坑：`JSON.parse('123456789012345')` **会成功**并返回一个
      // number——而好友码正好全是数字。所以不能只要 parse 成功就当对象用，
      // 必须再确认它真的是对象，否则按裸字符串处理。
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate;
      } else {
        return { kind: 'friendCode', value: trimmed };
      }
    } catch (error) {
      // 不是 JSON 就当作裸字符串（历史格式）
      return { kind: 'friendCode', value: trimmed };
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const kind = typeof parsed.kind === 'string' && parsed.kind ? parsed.kind : 'friendCode';
  const value = parsed.value === null || parsed.value === undefined ? '' : String(parsed.value).trim();
  if (!value) return null;

  return { kind, value };
}

/**
 * 把载荷转成要写入的键值对。
 *
 * 返回的是**纯数据**，不直接写存储——这样这个函数没有副作用，可以随便测。
 */
export function storageWritesFor(payload) {
  if (!payload || !payload.value) return [];

  if (payload.kind === 'qr') {
    return [{ key: 'qrInput', value: payload.value }];
  }

  const kind = payload.kind === 'qq' ? 'qq' : 'friendCode';
  const writes = [
    { key: 'queryKind', value: kind },
    { key: 'queryValue', value: payload.value },
  ];
  // 只查分那条路会读 friendCode 做兜底，只有好友码才需要镜像
  if (kind === 'friendCode') writes.push({ key: 'friendCode', value: payload.value });

  return writes;
}

/** 给用户看的一句话描述。 */
export function describePayload(payload) {
  if (!payload) return '数据';
  return KIND_LABELS[payload.kind] || '数据';
}
