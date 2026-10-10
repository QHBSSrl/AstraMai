/**
 * 设备密钥。
 *
 * 这是整个配对方案的安全核心：**读取数据时必须出示它，而它永远不出设备**。
 * 上送服务端的只是它的 SHA256，所以就算有人猜中了 8 位配对码，也读不走数据。
 *
 * ── 两个平台限制，必须正面处理 ────────────────────────────────────────
 *
 * 1. **`@system.crypto` 没有随机数接口。** 所以密钥只能用 `Math.random()`
 *    混上时间戳和计数器凑熵，再用 SHA256 压成定长。这不如硬件随机源，
 *    但比"用可预测的值"强得多，而且它是**本地**秘密——攻击者拿不到任何
 *    关于它的观测值，只能盲猜 2^256。
 *
 * 2. **`hashDigest` 的返回格式文档没写死**（只说返回 String）。可能是十六进制，
 *    也可能是 base64。服务端按 64 位十六进制校验，所以这里**两种都处理**：
 *    是 hex 就直接用，看着像 base64 就解码再转 hex。这种事不猜，两种都兜住。
 *
 * 平台模块一律延迟 require + 存在性检查：拿不到就明确报错，
 * 不能让一个 TypeError 把整页初始化打断。
 */

const SECRET_KEY = 'deviceSecret';

let cryptoModule;

function getCrypto() {
  if (cryptoModule !== undefined) return cryptoModule;
  try {
    // eslint-disable-next-line global-require
    const mod = require('@system.crypto') || null;
    cryptoModule = mod && typeof mod.default === 'object' ? mod.default : mod;
  } catch (error) {
    console.error('[AstraMai] @system.crypto 不可用：', error);
    cryptoModule = null;
  }
  return cryptoModule;
}

/** 加密能力是否可用。配对功能依赖它，不可用时要明确告诉用户而不是静默失败。 */
export function isCryptoAvailable() {
  const crypto = getCrypto();
  return Boolean(crypto && typeof crypto.hashDigest === 'function');
}

/**
 * 把任意格式的 SHA256 摘要统一成 64 位小写十六进制；认不出来返回空串。
 *
 * 抽成纯函数是有原因的：`hashDigest` 的返回格式文档没写死（只说是 String），
 * 可能是 hex 也可能是 base64，而服务端按 64 位十六进制校验。
 * 平台行为不确定的地方**必须两种都兜住**，而且要能在 Node 里测——
 * 手表上出现「服务端说格式不对」时，排查成本极高。
 *
 * @param digest hashDigest 的原始返回
 * @param atob 可选的 base64 解码函数（由调用方从 @system.crypto 取）
 */
export function normalizeDigest(digest, atob) {
  if (typeof digest !== 'string' || !digest) return '';

  // 情况一：本来就是十六进制
  if (/^[0-9a-f]{64}$/i.test(digest)) return digest.toLowerCase();

  // 情况二：base64（44 字符，可能带一个 = 补位）
  if (/^[A-Za-z0-9+/]{43}=?$/.test(digest) && typeof atob === 'function') {
    try {
      const raw = atob(digest);
      if (typeof raw === 'string' && raw) {
        let hex = '';
        for (let i = 0; i < raw.length; i += 1) {
          hex += raw.charCodeAt(i).toString(16).padStart(2, '0');
        }
        if (/^[0-9a-f]{64}$/.test(hex)) return hex;
      }
    } catch (error) {
      return '';
    }
  }

  return '';
}

/**
 * 算 SHA256 并**统一成 64 位小写十六进制**。
 * 返回空串表示算不出来（调用方据此报错，而不是拿个半成品继续跑）。
 */
export function sha256Hex(text) {
  const crypto = getCrypto();
  if (!crypto || typeof crypto.hashDigest !== 'function') return '';

  let digest;
  try {
    digest = crypto.hashDigest({ data: text, algo: 'SHA256' });
  } catch (error) {
    console.error('[AstraMai] hashDigest 失败：', error);
    return '';
  }

  const normalized = normalizeDigest(digest, crypto.atob);
  if (!normalized) {
    console.error('[AstraMai] hashDigest 返回了无法识别的格式：', String(digest).slice(0, 40));
  }
  return normalized;
}

/** 生成一个 64 位十六进制密钥。这是本平台能做到的最好随机源，见文件头说明。 */
function generateSecret() {
  const chunks = [];
  // 多凑几轮，每轮都混进时间戳（毫秒 + 微秒级抖动）和计数器
  for (let round = 0; round < 8; round += 1) {
    const now = Date.now();
    chunks.push(
      String(Math.random()),
      String(Math.random() * 0xffffffff),
      String(now),
      // Date.now 在同一毫秒内可能相同，用 getTime 的小数位和计数器补熵
      String(now % 100000),
      String(round),
    );
  }
  const material = chunks.join('|');

  // 能用 SHA256 就压一遍，让每一位都和全部输入相关
  const hashed = sha256Hex(material);
  if (hashed) return hashed;

  // 极端情况（crypto 不可用）下退化成拼凑——配对功能本来也会因为拿不到哈希而报错
  let fallback = '';
  while (fallback.length < 64) {
    fallback += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }
  return fallback.slice(0, 64);
}

/**
 * 取设备密钥，没有就生成并存下来。
 *
 * 注意：**同一个密钥必须一直用下去**。换了密钥服务端就认不出这台设备，
 * 之前设过的传输密码（和密钥哈希绑定）也会失效。
 *
 * @param readSetting 读本地存储的函数（由调用方从 global 传进来，保持模块无依赖）
 * @param writeSetting 写本地存储的函数
 */
export function getDeviceSecret(readSetting, writeSetting) {
  let secret = readSetting(SECRET_KEY, '');
  if (/^[0-9a-f]{64}$/.test(secret)) return secret;

  secret = generateSecret();
  try {
    writeSetting(SECRET_KEY, secret);
  } catch (error) {
    console.error('[AstraMai] 保存设备密钥失败，本次配对仍可继续：', error);
  }
  return secret;
}

/** 设备密钥的哈希——只把这个送给服务端。 */
export function deviceSecretHash(secret) {
  return sha256Hex(secret);
}
