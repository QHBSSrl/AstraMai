/**
 * 浏览器端的 AES 适配（WebCrypto）。
 *
 * ── 为什么放在 core 里 ──────────────────────────────────────────────
 *
 * 一开始它写在 `apps/web/src/sync/aes.ts`，但那样**没法测** ——
 * apps/web 没有测试运行器，而这段代码的正确性必须被验证：
 * 它加出来的密文，手表用 `@system.crypto` 必须能解开。
 *
 * 放进 core 之后可以用 node 的测试跑，并且能拿 **Node 自己的
 * `crypto.createCipheriv('aes-128-cbc')` 当参考实现逐字节比对** ——
 * 那等价于证明了"标准 AES-128-CBC/PKCS7"，也就是手表那一侧的算法。
 *
 * 手表的适配在 `apps/vela/src/common/sync-aes.js`，不动这里。
 *
 * ── 为什么适配层要单独一个文件 ──────────────────────────────────────
 *
 * 手表用 `crypto.encrypt`（回调式、key 是 base64 字符串），
 * 浏览器用 `crypto.subtle`（Promise 式、key 是 CryptoKey 对象）。
 * **两边的 API 没有一个参数是共通的。**
 *
 * 唯一能保证一致的是：
 *   · 密钥字节 —— core 的 `deriveKeyBase64`
 *   · IV 字节   —— core 的 `deriveIvBase64`
 *   · 算法参数  —— **AES-128-CBC + PKCS#7 填充**
 *
 * 所以这个文件只做参数翻译。**推导逻辑一行都不许写在这里。**
 *
 * ⚠️ WebCrypto 的 `AES-CBC` **自带 PKCS#7 填充**，和 Vela 默认的
 *    `AES/CBC/PKCS7Padding` 一致。不要自己再补一遍，否则两边的
 *    密文长度会差一截。
 */

import { base64ToBytes, bytesToBase64 } from './payload.js';

/** 用 AES-128-CBC 加密，返回密文的 base64。 */
export async function encryptSyncPayload(
  plaintext: string,
  keyBase64: string,
  ivBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64, 'encrypt');
  const iv = new Uint8Array(base64ToBytes(ivBase64));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  return toBase64(new Uint8Array(ciphertext));
}

/**
 * 用 AES-128-CBC 解密。
 *
 * 解密失败会**抛异常** —— 不要吞掉后返回空串。
 * 那会让"输错 PIN"和"服务器返回了坏数据"变成同一个现象，
 * 用户看到的只是"什么都没有"。
 */
export async function decryptSyncPayload(
  ciphertextBase64: string,
  keyBase64: string,
  ivBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64, 'decrypt');
  const iv = new Uint8Array(base64ToBytes(ivBase64));

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    key,
    new Uint8Array(base64ToBytes(ciphertextBase64)),
  );

  return new TextDecoder().decode(plain);
}

async function importKey(keyBase64: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const raw = new Uint8Array(base64ToBytes(keyBase64));

  // 16 字节 = AES-128。长度不对直接报错，别指望 subtle 给有用的提示
  if (raw.length !== 16) {
    throw new Error(`AES 密钥必须是 16 字节，实际 ${raw.length}`);
  }

  return crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, [usage]);
}

/** 字节 → base64。走 payload.js 的实现，保证两端同一套编码。 */
function toBase64(bytes: Uint8Array): string {
  const list: number[] = [];
  for (const byte of bytes) list.push(byte);
  return bytesToBase64(list);
}
