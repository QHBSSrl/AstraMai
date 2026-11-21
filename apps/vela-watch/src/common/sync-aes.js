/**
 * 手表端的 AES 适配（`@system.crypto`）。
 *
 * ── 和浏览器那侧的对应关系 ──────────────────────────────────────────
 *
 *   浏览器：`packages/core/src/sync/aes-web.ts`（WebCrypto，Promise）
 *   手表  ：这个文件（`crypto.encrypt`，回调式）
 *
 * 两边**共用** core 的 `deriveKeyBase64` / `deriveIvBase64`，
 * 所以密钥和 IV 的字节一定相同。算法两边都是 AES-128-CBC + PKCS#7，
 * 而 web 那侧的密文已经用 **Node 的 `createCipheriv` 逐字节比对过**
 * （`sync-aes.test.mjs`）—— 所以手表能解开浏览器加密的数据。
 *
 * ── 官方文档的几个坑（都踩过一遍文档）────────────────────────────────
 *
 * 1. **`key` 是 base64 字符串**，不是原始字节。
 *    而且只编一层 —— 文档示例是 `crypto.btoa('KEYKEYKEYKEYKEYK')`，
 *    16 个字符 → 24 个 base64 字符。我们的 `deriveKeyBase64` 正好
 *    返回这一层，**不要再用 btoa 包一次**。
 *
 * 2. **`data` 传字符串时，返回值也是 base64 字符串**；
 *    传 Uint8Array 才返回 Uint8Array。我们全程用字符串，
 *    因为密文要放进 JSON 传给服务器。
 *
 * 3. **`iv` 的默认值是 key**。我们**必须显式传**，
 *    否则 IV 会等于密钥 —— 那是不该出现的情况（会削弱 CBC 的语义）。
 *
 * 4. 手表**没有随机数接口**，所以 IV 不能随机。用配对码派生
 *    （`deriveIvBase64`），配对码本身是服务器随机生成的。
 *
 * ── 返回值为什么是 Promise ──────────────────────────────────────────
 *
 * `crypto.encrypt` 是回调式，但调用方（页面里的 `await`）用 Promise
 * 写起来清楚得多，而且和 web 那侧的签名一致 —— 两边的调用代码
 * 可以长得几乎一样。
 */

const crypto = require('@system.crypto');

/**
 * 这台设备能不能同步。
 *
 * 手环全系不支持 AES（官方支持明细里写明了），
 * 所以必须先探测再走流程 —— 否则用户点下去才报错。
 */
export function isSyncCryptoAvailable() {
  return Boolean(crypto && typeof crypto.encrypt === 'function' && typeof crypto.decrypt === 'function');
}

/**
 * 用 AES-128-CBC 加密，返回密文的 base64。
 *
 * @param {string} plaintext 明文
 * @param {string} keyBase64 core 的 deriveKeyBase64 产出
 * @param {string} ivBase64  core 的 deriveIvBase64 产出
 */
export function encryptSyncPayload(plaintext, keyBase64, ivBase64) {
  return new Promise((resolve, reject) => {
    if (!isSyncCryptoAvailable()) {
      reject(new Error('这台设备不支持加密'));
      return;
    }

    try {
      crypto.encrypt({
        data: plaintext,
        algo: 'AES',
        key: keyBase64,
        options: {
          // 显式传 iv —— 文档默认值是 key，我们不能接受那个默认
          iv: ivBase64,
          transformation: 'AES/CBC/PKCS7Padding',
        },
        success(result) {
          const data = result && result.data;
          if (typeof data !== 'string' || !data) {
            reject(new Error('加密没有返回数据'));
            return;
          }
          resolve(data);
        },
        fail(data, code) {
          reject(new Error(`加密失败（${code}）：${data}`));
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 用 AES-128-CBC 解密，返回明文。
 *
 * 解密失败**必须 reject** —— 不要 resolve 空串。
 * 那会让"输错密码"和"数据坏了"变成同一个现象，
 * 用户在手表上只会看到"什么都没有"。
 */
export function decryptSyncPayload(ciphertextBase64, keyBase64, ivBase64) {
  return new Promise((resolve, reject) => {
    if (!isSyncCryptoAvailable()) {
      reject(new Error('这台设备不支持解密'));
      return;
    }

    try {
      crypto.decrypt({
        data: ciphertextBase64,
        algo: 'AES',
        key: keyBase64,
        options: {
          iv: ivBase64,
          transformation: 'AES/CBC/PKCS7Padding',
        },
        success(result) {
          const data = result && result.data;
          if (typeof data !== 'string') {
            reject(new Error('解密没有返回文本'));
            return;
          }
          resolve(data);
        },
        fail(data, code) {
          // 这里最常见的原因是密码输错 —— 提示里要带出来
          reject(new Error(`解密失败（${code}）：${data}`));
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}

export default {
  isSyncCryptoAvailable,
  encryptSyncPayload,
  decryptSyncPayload,
};
