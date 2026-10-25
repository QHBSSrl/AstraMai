/**
 * 舞立方（DanceCube）数据源。
 *
 * ── 上游是谁 ────────────────────────────────────────────────────────
 *
 * 盛华娱乐（`dancedemo.shenghuayule.com`）的私有 API。
 * **没有公开文档、没有承诺、随时可能变。**
 *
 * 接口清单和字段名来自参考项目 `LingerJAB/DanceCubeBot`（GPL-3.0）——
 * 我们只用它作为**接口事实**的来源，实现是自己写的。
 *
 * ── 和别的源最大的不同 ──────────────────────────────────────────────
 *
 * 1. **登录是微信扫码 + OAuth**
 *    出码 → 扫 → 轮询 `/Dance/token` → 拿到 `access_token` / `refresh_token`。
 *    所以这个源有两个"阶段"：**未登录**（只能拿二维码）和**已登录**（能查数据）。
 *
 * 2. **没有「一次拿全部成绩」的接口**
 *    B15 要按曲风（2–6）分别拉 `GetMyRankNew`，再自己排序。
 *    一个玩家的查询 = 5 次曲风请求 + 1 次最近游玩 + 1 次玩家信息 = **7 次上游**。
 *    比别的游戏贵，所以**必须缓存**（缓存由 gateway 负责，这里只管取一次）。
 *
 * 3. **返回的手机号直接丢掉**
 *    `GetInfo` 会返回 `Phone`。我们**不解析、不存、不记录**。
 */

import type { DanceCubePlayer, DanceCubeScore } from '@astramai/core';
import {
  DANCECUBE_CATEGORIES,
  buildDanceCubeView,
  flattenRankItem,
  scoreRatio,
} from '@astramai/core';

import type { DataSource, PlayerQuery, RawLibrary, SourceDescriptor } from './types.js';
import { UpstreamLimiter } from './upstream-limiter.js';

/** 上游基址。写死，和参考项目一致。 */
const BASE = 'https://dancedemo.shenghuayule.com/Dance';

/**
 * 上游的硬性限流。
 *
 * ⚠️ **这个数字不是我们定的，是猜的。**
 * 上游没有公开的限流说明。参考项目里每次查询之间 sleep 4 秒，
 * 看起来是"怕被封"的经验值，不是官方上限。
 *
 * 取 30 次/分钟 —— 一个玩家查询要 7 次，也就是**每分钟大约 4 个人**。
 * 宁可贵一点也别把服务打成黑名单。
 */
const HARD_LIMIT = 30;

/** 一次查询要花多少次上游调用（5 曲风 + 最近 + 信息）。 */
const COST_PER_VIEW = DANCECUBE_CATEGORIES.length + 2;

export interface DanceCubeSourceOptions {
  /** 共享的上游预算计数器。 */
  limiter: UpstreamLimiter;
  /** 打日志用。 */
  label?: string;
}

/** 二维码登录的中间状态。 */
export interface DanceCubeQr {
  /** 上游给的 ID，轮询时要用它换 token。 */
  id: string;
  /** 微信二维码图片地址。 */
  qrcodeUrl: string;
}

/** 登录成功后的凭证。 */
export interface DanceCubeToken {
  userId: number;
  accessToken: string;
  refreshToken: string;
}

export class DanceCubeSource implements DataSource {
  readonly id = 'dancecube';
  readonly label = '舞立方（盛华娱乐）';
  readonly games = ['dancecube'] as const;
  readonly hardLimitPerMinute = HARD_LIMIT;

  constructor(private readonly options: DanceCubeSourceOptions) {}

  describe(): SourceDescriptor {
    return {
      id: this.id,
      label: this.label,
      games: this.games,
      // 不需要开发者密钥 —— 每个玩家用自己的微信扫码换 token
      requiresKey: false,
      available: true,
    };
  }

  /**
   * 舞立方**不支持**按好友码/QQ/用户名查询。
   *
   * 它的玩家标识是「微信扫码换来的 userId」，
   * 所以这个源走的是 `fetchView(userId, token)`，不走 `PlayerQuery`。
   */
  supports(): boolean {
    return false;
  }

  /** 舞萌那套接口，舞立方用不上。 */
  getPlayer(): Promise<never> {
    return Promise.reject(new Error('舞立方不支持按好友码查询，请先用微信扫码登录'));
  }

  getBests(): Promise<never> {
    return Promise.reject(new Error('舞立方不支持按好友码查询，请先用微信扫码登录'));
  }

  /** 舞立方没有我们需要的曲库接口（曲目信息随成绩一起返回）。 */
  fetchLibrary(): Promise<RawLibrary> {
    return Promise.reject(new Error('舞立方没有曲库接口'));
  }

  // ══════════════════════════════════════════════════════════════════
  // 登录
  // ══════════════════════════════════════════════════════════════════

  /** 拿一个新的二维码。 */
  async createQr(): Promise<DanceCubeQr> {
    this.options.limiter.spend(1, this.label);

    const data = await this.requestJson<{ ID?: string; QrcodeUrl?: string }>(
      '/api/Common/GetQrCode',
    );

    const id = String(data.ID ?? '').trim();
    const qrcodeUrl = String(data.QrcodeUrl ?? '').trim();

    if (!id || !qrcodeUrl) {
      throw new Error('上游没返回二维码（ID 或 QrcodeUrl 是空的）');
    }

    return { id, qrcodeUrl };
  }

  /**
   * 用二维码 ID 换 token。
   *
   * ⚠️ **这是一个"长轮询"语义的上游**：没扫码时返回 400 `unauthorized_client`，
   * 扫了就返回 200 带 token。所以调用方应该**反复调用这个**，
   * 而不是等一个推送。
   *
   * 我们不在服务端替你轮询（那会占住一个连接 5 分钟），
   * 而是让客户端每 4 秒问一次我们的接口，我们再问上游一次 ——
   * 这样超时和重试都由客户端控制。
   */
  async pollToken(id: string): Promise<DanceCubeToken | null> {
    this.options.limiter.spend(1, this.label);

    const body = new URLSearchParams({
      client_type: 'qrcode',
      grant_type: 'client_credentials',
      client_id: id,
    }).toString();

    const response = await fetch(`${BASE}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    // 400 = 还没扫，这是**正常状态**，不是错误
    if (response.status === 400) return null;

    if (!response.ok) {
      throw new Error(`换 token 失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      userId?: number;
      access_token?: string;
      refresh_token?: string;
    };

    const userId = Number(data.userId ?? 0);
    const accessToken = String(data.access_token ?? '').trim();

    if (!userId || !accessToken) {
      throw new Error('上游返回的 token 不完整');
    }

    return {
      userId,
      accessToken,
      refreshToken: String(data.refresh_token ?? '').trim(),
    };
  }

  /**
   * 续期。
   *
   * 舞立方给的是标准 OAuth refresh_token，过期了可以用它换新的。
   * 这一步失败就要求玩家重新扫码。
   */
  async refreshToken(refreshToken: string): Promise<DanceCubeToken | null> {
    this.options.limiter.spend(1, this.label);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString();

    const response = await fetch(`${BASE}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      userId?: number;
      access_token?: string;
      refresh_token?: string;
    };

    const userId = Number(data.userId ?? 0);
    const accessToken = String(data.access_token ?? '').trim();
    if (!userId || !accessToken) return null;

    return {
      userId,
      accessToken,
      refreshToken: String(data.refresh_token ?? refreshToken).trim(),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // 查数据
  // ══════════════════════════════════════════════════════════════════

  /** 玩家信息。 */
  async getInfo(token: DanceCubeToken): Promise<DanceCubePlayer> {
    this.options.limiter.spend(1, this.label);

    const raw = await this.requestJson<Record<string, unknown>>(
      `/api/User/GetInfo?userId=${token.userId}`,
      token.accessToken,
    );

    /*
     * ⚠️ 上游这里会带 `Phone`（手机号）。**我们不解析、不保存、不记录。**
     * 下面只挑需要的字段，Phone 直接被丢掉 —— 这不是疏忽，
     * 是「不碰用户没同意给的数据」。
     */
    return {
      userId: Number(raw.UserID ?? token.userId),
      name: String(raw.UserName ?? ''),
      avatarUrl: String(raw.HeadimgURL ?? ''),
      ratio: Number(raw.LvRatio ?? 0),
      musicScore: Number(raw.MusicScore ?? 0),
      rankNation: Number(raw.RankNation ?? 0),
      comboPercent: Number(raw.ComboPercent ?? 0),
      cityName: String(raw.CityName ?? ''),
      teamName: String(raw.TeamName ?? ''),
      titleUrl: String(raw.TitleUrl ?? ''),
    };
  }

  /**
   * 拉一个曲风下的全部成绩。
   *
   * 上游返回的是「曲目列表」，每首曲目下面还有 `ItemRankList`（我打过的谱面）。
   * 这里拍平成一条条成绩。
   */
  async getCategoryCharts(category: number, token: DanceCubeToken): Promise<DanceCubeScore[]> {
    this.options.limiter.spend(1, this.label);

    const list = await this.requestJson<unknown[]>(
      `/api/User/GetMyRankNew?musicIndex=${category}`,
      token.accessToken,
    );

    if (!Array.isArray(list)) return [];

    const out: DanceCubeScore[] = [];

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;

      const charts = record.ItemRankList;
      if (!Array.isArray(charts)) continue;

      out.push(
        ...flattenRankItem({
          musicId: Number(record.MusicID ?? 0),
          name: String(record.Name ?? ''),
          ownerType: Number(record.OwnerType ?? 0),
          charts: charts.map((chart) => {
            const c = (chart ?? {}) as Record<string, unknown>;
            return {
              difficulty: Number(c.MusicLevOld ?? 0),
              level: Number(c.MusicRank ?? 0),
              levelKind: Number(c.MusicLev ?? 1),
              percent: Number(c.PlayerPercent ?? 0),
              score: Number(c.PlayerScore ?? 0),
              comboCount: Number(c.ComboCount ?? 0),
              miss: Number(c.PlayerMiss ?? 0),
              ranking: Number(c.MusicRanking ?? 0),
            };
          }),
        }),
      );
    }

    return out;
  }

  /** 最近游玩。 */
  async getRecentCharts(token: DanceCubeToken): Promise<DanceCubeScore[]> {
    this.options.limiter.spend(1, this.label);

    const list = await this.requestJson<unknown[]>('/api/User/GetLastPlay', token.accessToken);
    if (!Array.isArray(list)) return [];

    return list.map((item) => {
      const raw = (item ?? {}) as Record<string, unknown>;
      const level = Number(raw.MusicRank ?? 0);
      const percent = Number(raw.PlayerPercent ?? 0);

      return {
        musicId: Number(raw.MusicID ?? 0),
        name: String(raw.Name ?? ''),
        difficulty: Number(raw.MusicLevOld ?? 0),
        level,
        levelKind: Number(raw.MusicLev ?? 1),
        accuracy: percent / 100,
        score: Number(raw.PlayerScore ?? 0),
        combo: Number(raw.ComboCount ?? 0),
        miss: Number(raw.PlayerMiss ?? 0),
        ratio: scoreRatio(percent / 100, level),
        // 最近游玩没有排名
        ranking: 0,
      };
    });
  }

  /**
   * 完整的查询：玩家 + B15 + Recent15。
   *
   * ⚠️ **7 次上游调用**（信息 1 + 曲风 5 + 最近 1）。
   * 所以调用方**必须缓存**，否则一个人连点两下就是 14 次。
   */
  async fetchView(token: DanceCubeToken) {
    const player = await this.getInfo(token);

    // 5 个曲风并发拉 —— 串行要 5 秒，并发 1 秒
    const categories = await Promise.all(
      DANCECUBE_CATEGORIES.map((category) =>
        this.getCategoryCharts(category, token).catch(() => [] as DanceCubeScore[]),
      ),
    );

    const recentCharts = await this.getRecentCharts(token).catch(() => [] as DanceCubeScore[]);

    return buildDanceCubeView({
      player,
      allCharts: categories.flat(),
      recentCharts,
    });
  }

  /** 一次查询的上游成本，给 gateway 算预算用。 */
  static costPerView(): number {
    return COST_PER_VIEW;
  }

  // ══════════════════════════════════════════════════════════════════
  // 底层
  // ══════════════════════════════════════════════════════════════════

  /**
   * 发一个 GET，解析 JSON。
   *
   * 带 `Authorization` 时是 `Bearer <accessToken>`（上游是标准 OAuth）。
   */
  private async requestJson<T>(path: string, accessToken?: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;

    const response = await fetch(`${BASE}${path}`, { headers });

    if (!response.ok) {
      // 401 = 令牌过期，调用方应该去 refresh
      const text = await response.text().catch(() => '');
      throw new Error(`上游返回 HTTP ${response.status}${text ? `：${text.slice(0, 120)}` : ''}`);
    }

    return (await response.json()) as T;
  }
}
