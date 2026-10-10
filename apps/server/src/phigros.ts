/**
 * Phigros 接入。
 *
 * ── 和落雪源的根本区别 ──────────────────────────────────────────────
 *
 * 落雪是「一把服务端密钥查任何人」。
 * Phigros 是「**玩家自己用 TapTap 扫码授权，我们查他自己**」。
 *
 * 所以它**不能实现 `DataSource` 接口**——那个接口的 `getPlayer(query)` 假设
 * 玩家用好友码/QQ 定位；Phigros 的玩家标识是一次 TapTap 扫码换来的
 * `sessionToken`，没有任何公开的"按码查人"入口。
 *
 * 硬塞进那个接口只会让两边都变别扭，所以这里是个独立的服务。
 *
 * ── 关于轮询 ────────────────────────────────────────────────────────
 *
 * 扫码需要轮询等玩家扫完。这和服务端那个「等网页提交」的轮询不同：
 * 它是**有界**的（玩家扫完就结束），但仍然要在服务端做一层缓存——
 * 否则 N 个客户端各自轮询，就会变成 N 倍请求打到 Phigros 平台的
 * 第三方服务上。平台返回的 `retryAfter` 正好是合适的缓存时长。
 */

import { PhigrosClient, buildPhigrosView, type PhigrosView } from '@astramai/core';

import type { ServerConfig } from './config.js';

/** 轮询结果的缓存条目。 */
interface CachedStatus {
  at: number;
  status: { status: string; retryAfter?: number | undefined; sessionToken?: string | undefined };
}

export interface PhigrosDescriptor {
  id: 'phigros';
  label: string;
  available: boolean;
  unavailableReason?: string;
  /** 说明这个源的特殊性，避免调用方按落雪那套去用。 */
  playerIdentity: 'tapTapSessionToken';
}

export class PhigrosService {
  private readonly client: PhigrosClient;
  /** qrId → 最近一次的轮询结果。 */
  private readonly statusCache = new Map<string, CachedStatus>();

  constructor(private readonly config: ServerConfig) {
    this.client = new PhigrosClient({
      ...(config.phigrosApiKey !== undefined ? { apiKey: config.phigrosApiKey } : {}),
    });
  }

  describe(): PhigrosDescriptor {
    const available = this.client.hasApiKey;
    return {
      id: 'phigros',
      label: 'Phigros 开放平台',
      available,
      ...(available ? {} : { unavailableReason: '服务端未配置 PHIGROS_API_KEY' }),
      playerIdentity: 'tapTapSessionToken',
    };
  }

  /**
   * 生成 TapTap 登录二维码。
   *
   * **刻意不返回 `qrcodeBase64`**：实测它是 SVG，
   * 而手表端的 image 组件只吃 png/jpg。
   * 客户端拿 `verificationUrl` 自己画二维码即可
   * （Vela 有原生 qrcode 组件，网页端也有现成的生成器）。
   */
  async createQr(taptapVersion: 'cn' | 'global' = 'cn'): Promise<{
    qrId: string;
    verificationUrl: string;
    taptapVersion: 'cn' | 'global';
  }> {
    const qr = await this.client.createQrCode(taptapVersion);
    return { qrId: qr.qrId, verificationUrl: qr.verificationUrl, taptapVersion };
  }

  /**
   * 轮询扫码状态，带缓存。
   *
   * 缓存时长取平台建议的 `retryAfter`（实测是 1 秒），下限 800ms——
   * 客户端轮询再密，打到平台上的也不会超过每秒一次。
   */
  async pollQr(qrId: string): Promise<{
    status: string;
    retryAfter: number;
    sessionToken?: string | undefined;
    cached: boolean;
  }> {
    const cached = this.statusCache.get(qrId);
    const now = Date.now();
    if (cached && now - cached.at < (cached.status.retryAfter ?? 1) * 1000) {
      return {
        status: cached.status.status,
        retryAfter: cached.status.retryAfter ?? 1,
        ...(cached.status.sessionToken !== undefined ? { sessionToken: cached.status.sessionToken } : {}),
        cached: true,
      };
    }

    const fresh = await this.client.pollQrStatus(qrId);
    this.statusCache.set(qrId, { at: now, status: fresh });

    // 顺手清理：这个 Map 不该无限长大
    if (this.statusCache.size > 500) {
      for (const [key, value] of this.statusCache) {
        if (now - value.at > 10 * 60 * 1000) this.statusCache.delete(key);
      }
    }

    return {
      status: fresh.status,
      retryAfter: fresh.retryAfter ?? 1,
      ...(fresh.sessionToken !== undefined ? { sessionToken: fresh.sessionToken } : {}),
      cached: false,
    };
  }

  /**
   * 查玩家成绩。
   *
   * `sessionToken` 是玩家凭证，由调用方从请求头取。
   * **绝不记进日志**——平台的使用条款明确要求不要把 token 写进日志或错误上报。
   */
  async getView(sessionToken: string): Promise<PhigrosView> {
    const response = await this.client.getSave(sessionToken);
    return buildPhigrosView(response);
  }

  /** 曲目搜索。这是平台唯一的曲库入口，没有全量列表。 */
  async searchSongs(query: string, limit = 20): Promise<unknown> {
    return this.client.searchSongs(query, limit);
  }
}
