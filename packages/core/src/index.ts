/**
 * @astramai/core 公共入口。
 *
 * 分层：
 *   lxns/    —— 落雪 API 契约（类型、端点、客户端、错误）
 *   maimai/  —— 舞萌 DX 领域逻辑（Rating 计算、B50 组装、常量、格式化）
 *   mock/    —— 确定性模拟数据
 *
 * 本包零运行时依赖，且不引用任何 DOM / Node 专有 API，
 * 以便同一份逻辑在 Web 测试站与小米 Vela QuickApp 中复用。
 */

// ── 落雪 API ────────────────────────────────────────────────────────────
export * from './lxns/types.js';
export * from './lxns/endpoints.js';
export * from './lxns/errors.js';
export * from './lxns/client.js';

// ── 舞萌 DX 领域逻辑 ────────────────────────────────────────────────────
export * from './maimai/constants.js';
export * from './maimai/rating.js';
export * from './maimai/format.js';
export * from './maimai/b50.js';

// ── 模拟数据 ────────────────────────────────────────────────────────────
export * from './mock/generate.js';
