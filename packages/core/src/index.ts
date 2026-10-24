/**
 * @astramai/core 公共入口。
 *
 * 分层：
 *   lxns/      —— 落雪 API 契约（类型、端点、客户端、错误）
 *                舞萌 DX 与中二节奏共用同一个上游服务，所以类型都在这一层
 *   maimai/    —— 舞萌 DX 领域逻辑（Rating 计算、B50 组装、常量、格式化）
 *   chunithm/  —— 中二节奏领域逻辑（难度档位、配色、文本映射）
 *   mock/      —— 确定性模拟数据
 *
 * 本包零运行时依赖，且不引用任何 DOM / Node 专有 API，
 * 以便同一份逻辑在 Web 测试站与小米 Vela QuickApp 中复用。
 */

// ── 通用工具 ────────────────────────────────────────────────────────────
export * from './util/utf8.js';

// ── 落雪 API ────────────────────────────────────────────────────────────
export * from './lxns/types.js';
export * from './lxns/chunithm-types.js';
export * from './lxns/endpoints.js';
export * from './lxns/errors.js';
export * from './lxns/client.js';

// ── 舞萌 DX 领域逻辑 ────────────────────────────────────────────────────
export * from './maimai/constants.js';
export * from './maimai/rating.js';
export * from './maimai/push.js';
export * from './maimai/diff.js';
export * from './maimai/format.js';
export * from './maimai/b50.js';
export * from './maimai/qr-payload.js';
export * from './sync/payload.js';
export * from './sync/aes-web.js';

// ── 中二节奏领域逻辑 ────────────────────────────────────────────────────
export * from './chunithm/constants.js';
export * from './chunithm/bests.js';

// ── Phigros ─────────────────────────────────────────────────────────────
// 和落雪是两个完全不同的平台（玩家标识来自 TapTap 扫码、没有全量曲库接口），
// 所以单独一层，不塞进 lxns/ 里。
export * from './phigros/types.js';
export * from './phigros/client.js';
export * from './phigros/bests.js';

// ── osu! ────────────────────────────────────────────────────────────────
// 第三个独立平台：官方 API v2 + OAuth2，玩家标识是用户名。
export * from './osu/types.js';
export * from './osu/bests.js';

// ── 二维码（零依赖，Vela 端可直接复用）────────────────────────────────
export * from './qr/index.js';

// ── 模拟数据 ────────────────────────────────────────────────────────────
export * from './mock/generate.js';
