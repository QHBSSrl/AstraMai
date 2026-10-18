/**
 * 用户群信息。
 *
 * ── 为什么要单独一个文件 ────────────────────────────────────────────
 *
 * 上线第一天的数据：**1200 浏览 → 32 下载 → 1 个入群**。
 *
 * 下载转化 2.7%（正常），但入群转化只有 3%——用户下完就走了，
 * 我们**没有第二条触达路径**。发版公告、bug 修复、新功能投票都发不出去。
 *
 * 所以加了这个模块 + 首次启动引导（OOBE）。群号放在这里而不是写死在页面里：
 * 以后换群只改这一处。
 *
 * ── 怎么填 ──────────────────────────────────────────────────────────
 *
 * QQ_GROUP 填群号（纯数字）。填了才会出「加群」这一步、设置页才会那一行。
 * 留空则整条路径不出现——**没配就别显示一个空群号**。
 *
 * QQ_GROUP_KEY 是可选的加群链接 key。有的话可以生成二维码让人扫，
 * 没有就只显示群号（手表上手动搜群号也行）。
 */

/**
 * QQ 群号。**填纯数字，不要带「群」字。**
 *
 * 留空 = 不显示任何加群入口。
 */
export const QQ_GROUP = '308532898';

/**
 * 加群链接的 key（可选）。
 *
 * 形如 `https://qm.qq.com/cgi-bin/qm/qr?k=<KEY>` 里的 `<KEY>`。
 * 填了就能在引导页显示二维码；留空只显示群号。
 *
 * 怎么拿：QQ 群设置 → 群二维码 → 复制链接，取 `k=` 后面那段。
 */
export const QQ_GROUP_KEY = '';

/** 有没有配置群号。没配就整条加群路径都不出现。 */
export function hasCommunity() {
  return typeof QQ_GROUP === 'string' && QQ_GROUP.trim().length > 0;
}

/** 群号（去掉空白）。没配返回空串。 */
export function groupNumber() {
  return hasCommunity() ? QQ_GROUP.trim() : '';
}

/**
 * 加群链接。没配 key 时返回空串。
 *
 * ⚠️ 注意：手表上的二维码是给人**用手机扫**的。
 * 466px 的屏幕放二维码，实际能扫的尺寸大概 260–300px，
 * 所以二维码不能塞满整屏——要给白边留位置（二维码必须是白底黑码）。
 */
export function groupUrl() {
  const key = (QQ_GROUP_KEY || '').trim();
  if (!key) return '';
  return `https://qm.qq.com/cgi-bin/qm/qr?k=${encodeURIComponent(key)}&jump_from=webapi`;
}

/** 有没有可显示二维码的链接。 */
export function hasGroupQr() {
  return groupUrl().length > 0;
}
