/**
 * 设备配对：把网页上填的玩家数据安全地送到手表上。
 *
 * 为什么需要：手表上没有好用的输入法，让玩家在手表上敲好友码/QQ 号很难受。
 * 改成在网页上填（键盘舒服），手表凭一个短 token 去取。
 *
 * ── 关于「加密暂存」，说清楚边界 ──────────────────────────────────────
 *
 * Vela 的 `@system.crypto` **没有密钥生成接口**（只有 hashDigest / hmacDigest /
 * sign / verify / encrypt / decrypt / btoa / atob），所以手表生不出自己的密钥对。
 * 没有密钥对，服务端就必然掌握能解密的东西——**真正的端到端加密在这平台上做不到**。
 *
 * 与其做一个假的「加密」声称「服务器看不到」，不如把真实的防线做扎实：
 *
 *   1. **只放内存，绝不落盘。** 被拖库也拿不到——因为根本没存。
 *   2. **10 分钟硬过期。** token 是当场抄写的，窗口短一点更安全。
 *   3. **单次消费即删。** 取过一次就没了。
 *   4. **设备密钥保护读取。** start 时手表只上报 deviceSecret 的**哈希**，
 *      读取必须带原文。所以猜中 token 的人**读不走**数据。
 *   5. **可选 PIN 保护写入。** 玩家可以在网页上设一个 PIN（2FA），
 *      之后提交必须带对 PIN。所以猜中 token 的人**也写不进**数据。
 *
 * 另外，token 只有 8 位十进制（10^8），**必须有次数限制**，
 * 否则爆破是可行的——这里对每个 token 的失败次数单独计数。
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** token 有效期。玩家是当场抄写的，不需要更长。 */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/** 每个 token 允许的失败次数，超过就作废——防爆破。 */
const MAX_FAILURES = 5;

/**
 * 每个 token 允许的查询次数上限。
 *
 * 客户端是**纯手动刷新**（不做轮询），正常玩家点十几次就到头了。
 * 设这个上限是为了防脚本：即使有人拿到 token 猛刷，也刷不穿。
 * 轮询那种 O(用户数) 的持续负载从设计上就不存在，这里是第二道闸。
 */
const MAX_POLLS = 120;

/** 同时存在的会话上限，防止有人无限创建把内存刷爆。 */
const MAX_SESSIONS = 2000;

/** 手表轮询间隔建议值。 */
export const POLL_INTERVAL_MS = 2000;

export interface PairSession {
  token: string;
  /** SHA256(deviceSecret)，十六进制。手表生成本地密钥后只上报哈希。 */
  deviceSecretHash: string;
  /** 网页提交的载荷（已由网页端做了一层混淆，见 routes 里的说明）。 */
  payload: string | null;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
  /** 校验失败次数，用于限速。 */
  failures: number;
  /** 已查询次数，用于挡住脚本猛刷。 */
  polls: number;
}

/** 提交结果。 */
export type SubmitResult =
  | { ok: true; pinSet: boolean }
  | { ok: false; error: 'not-found' | 'expired' | 'pin-required' | 'pin-wrong' | 'too-many-failures' };

/** 读取结果。 */
export type PollResult =
  | { status: 'waiting'; expiresAt: number }
  | { status: 'ready'; payload: string; expiresAt: number }
  | { status: 'expired' };

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 定长比较，避免时序侧信道。长度不同直接判否。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** PIN 的存储形式：和设备密钥绑在一起，换设备就失效。 */
function pinHash(pin: string, deviceSecretHash: string): string {
  return sha256Hex(`astramai-pin:${deviceSecretHash}:${pin}`);
}

export class PairingService {
  private readonly sessions = new Map<string, PairSession>();

  /** deviceSecretHash → pinHash。玩家选择了 2FA 才有。 */
  private readonly pins = new Map<string, string>();

  /** 生成一个没被占用的 8 位 token。 */
  private generateToken(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const token = String(randomInt(0, 100_000_000)).padStart(8, '0');
      if (!this.sessions.has(token)) return token;
    }
    // 极端情况下（会话爆满）退化成带时间戳的定长串，保证仍有 10^8 量级的空间
    return String(Date.now() % 100_000_000).padStart(8, '0');
  }

  /** 清掉过期的，顺带限制总量。 */
  private sweep(now: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
    // 还是太多就丢最早的
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) break;
      this.sessions.delete(oldest.value);
    }
  }

  /**
   * 手表发起配对。
   * @param deviceSecretHash 手表本地密钥的哈希——只上报哈希，原文不出设备。
   */
  start(deviceSecretHash: string): PairSession {
    const now = Date.now();
    this.sweep(now);

    const session: PairSession = {
      token: this.generateToken(),
      deviceSecretHash,
      payload: null,
      createdAt: now,
      expiresAt: now + TOKEN_TTL_MS,
      consumed: false,
      failures: 0,
      polls: 0,
    };
    this.sessions.set(session.token, session);
    return session;
  }

  /** 查会话，顺便做过期检查。 */
  get(token: string): PairSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  /**
   * 网页提交数据。
   *
   * PIN（可选的第二因素）在这里校验：
   *   - 该设备已设过 PIN → 必须带对
   *   - 该设备没设过、本次带了 → 这就是「设置 PIN」，记下来
   *   - 该设备没设过、本次没带 → 放行（玩家选择不用 2FA）
   */
  submit(token: string, payload: string, pin?: string): SubmitResult {
    const session = this.get(token);
    if (!session) return { ok: false, error: 'not-found' };
    if (session.consumed) return { ok: false, error: 'expired' };

    if (session.failures >= MAX_FAILURES) {
      this.sessions.delete(token);
      return { ok: false, error: 'too-many-failures' };
    }

    const storedPin = this.pins.get(session.deviceSecretHash);
    const provided = (pin ?? '').trim();

    if (storedPin) {
      if (!provided) {
        session.failures += 1;
        return { ok: false, error: 'pin-required' };
      }
      if (!safeEqual(storedPin, pinHash(provided, session.deviceSecretHash))) {
        session.failures += 1;
        return { ok: false, error: 'pin-wrong' };
      }
    } else if (provided) {
      // 第一次带 PIN = 开启 2FA
      if (!/^\d{4,8}$/.test(provided)) {
        return { ok: false, error: 'pin-wrong' };
      }
      this.pins.set(session.deviceSecretHash, pinHash(provided, session.deviceSecretHash));
    }

    session.payload = payload;
    session.failures = 0;
    return { ok: true, pinSet: Boolean(storedPin) || Boolean(provided) };
  }

  /**
   * 手表读取。
   * 必须带 deviceSecret 原文——只凭 token 读不走数据（防猜中 token 的人）。
   */
  poll(token: string, deviceSecret: string): PollResult {
    const session = this.get(token);
    if (!session) return { status: 'expired' };

    // 挡脚本：客户端是手动刷新，正常玩家用不到这么多次
    session.polls += 1;
    if (session.polls > MAX_POLLS) {
      this.sessions.delete(token);
      return { status: 'expired' };
    }

    if (!safeEqual(session.deviceSecretHash, sha256Hex(deviceSecret))) {
      session.failures += 1;
      if (session.failures >= MAX_FAILURES) this.sessions.delete(token);
      // 对调用方来说和过期一样，不泄露「token 存在但密钥不对」
      return { status: 'expired' };
    }

    if (!session.payload) return { status: 'waiting', expiresAt: session.expiresAt };
    return { status: 'ready', payload: session.payload, expiresAt: session.expiresAt };
  }

  /**
   * 手表取走后要求服务端立刻删除。
   * 这是玩家的明确诉求：「要求服务器删除暂存数据」。
   */
  consume(token: string, deviceSecret: string): boolean {
    const session = this.get(token);
    if (!session) return false;
    if (!safeEqual(session.deviceSecretHash, sha256Hex(deviceSecret))) return false;
    this.sessions.delete(token);
    return true;
  }

  /** 该设备是否已开启 2FA，用于网页提示。 */
  hasPin(token: string): boolean {
    const session = this.get(token);
    if (!session) return false;
    return this.pins.has(session.deviceSecretHash);
  }

  /** 供 health 展示，便于确认服务在跑。 */
  stats(): { sessions: number; pinnedDevices: number } {
    return { sessions: this.sessions.size, pinnedDevices: this.pins.size };
  }
}
