/**
 * 用户群信息。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 *
 * 上线第一天的数据：**1200 浏览 → 32 下载 → 1 个入群**。
 * 下载转化正常，但入群转化只有 3%——用户下完就走，
 * 我们**没有第二条触达路径**。发版公告、bug 修复、新功能投票都发不出去。
 *
 * ── 关于链接 ────────────────────────────────────────────────────────
 *
 * `QQ_GROUP_URL` 是 QQ 官方的**群分享链接**。比"只写群号"好用：
 * 扫码直接进群，不用手动搜。
 *
 * ⚠️ **这类链接里的 authKey / token 像是有签名的**，可能会过期。
 * 过期了就重新在 QQ 群里点「分享」拿一条新的，替换下面这个常量。
 * 群号 `QQ_GROUP` 是稳定的兜底——链接挂了用户还能搜群号。
 */

/** QQ 群号。**填纯数字**，不带「群」字。留空则整条加群路径都不出现。 */
export const QQ_GROUP = '308532898';

/**
 * 群分享链接（用于生成二维码）。
 * 留空则只显示群号、不显示二维码。
 */
export const QQ_GROUP_URL =
  'https://qun.qq.com/universal-share/share?ac=1&authKey=32jAuNOgcaGiMVRUzng%2FqxeCDEvBEgorqUSMqwZNIk0eMg1jwYAZiKRewlEk%2BVGO&busi_data=eyJncm91cENvZGUiOiIzMDg1MzI4OTgiLCJ0b2tlbiI6IkdYRitqaWVPL0dkZ2J1My9kS1BrZzhNRCtxY2d3NFp2WURDaDJjM0dLLzJZMG5kWk5tdUNiZDliYVRQYmplemwiLCJ1aW4iOiIzNjg3MjM2ODQ0In0%3D&data=X_ac6jjH-eXI4YIo0cUMgHoyJr4GoN522-MOVyHuBbW3r4rj-Mhqlnn6NuS7CErkofeMLCVltBwAYY4l6_VK2_VIKxFGQ3QQxllupbOmtxM&svctype=5&tempid=h5_group_info';

/** 有没有配置群号。没配就整条加群路径都不出现。 */
export function hasCommunity() {
  return typeof QQ_GROUP === 'string' && QQ_GROUP.trim().length > 0;
}

/** 群号（去掉空白）。没配返回空串。 */
export function groupNumber() {
  return hasCommunity() ? QQ_GROUP.trim() : '';
}

/**
 * 二维码里要编码的链接。
 *
 * ⚠️ 链接越长二维码越密，手机越难扫。
 * 上面这条带 `busi_data` 的大概 400 字符，在 180px 的二维码里**偏密**。
 * 如果实测扫不出来，换成短的：
 *
 *     https://qm.qq.com/cgi-bin/qm/qr?k=<authKey 那一段>
 *
 * 或者干脆只显示群号让人手动搜。
 */
export function groupUrl() {
  const url = (QQ_GROUP_URL || '').trim();
  if (!hasCommunity() || !url) return '';
  return url;
}

/** 有没有可显示二维码的链接。 */
export function hasGroupQr() {
  return groupUrl().length > 0;
}
