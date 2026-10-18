/**
 * osu! 数据源（官方 API v2）。
 *
 * ── 认证 ────────────────────────────────────────────────────────────
 *
 * osu! 用 **OAuth2**，而且我们只需要 **Client Credentials**——
 * 不涉及用户授权，用 `public` scope 就能读任何公开玩家的资料和成绩。
 *
 *    POST https://osu.ppy.sh/oauth/token
 *    client_id=…&client_secret=…&grant_type=client_credentials&scope=public
 *
 * 所以服务端必须持有 `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET`
 * （在 https://osu.ppy.sh/home/account/edit#new-oauth-application 注册）。
 * **玩家只需要提供用户名**，不需要登录。
 *
 * token 有效期 `expires_in` 秒（目前 86400 = 24 小时），这里缓存到
 * 到期前 60 秒再换新的——**不能每次请求都换**，那会消耗大量配额。
 *
 * ── ⚠️ 限流：这是本功能最硬的约束 ──────────────────────────────────
 *
 * 官方 ToS 原文：
 *
 *   「Please limit your usage to no more than 60 requests per minute
 *     (generally 1 request per second). … exceeding this specified limit
 *     may lead to your API tokens being revoked, or in serious abuse cases
 *     your access to the API being restricted.」
 *
 * 关键在于：**这个 60 是全应用共享的**，因为只有一个 client_id。
 * 我们有 100 个用户同时查询，也还是这 60。
 *
 * 所以：
 *   1. `hardLimitPerMinute = 60`，**与全局预算取小**——全局预算是 150 时
 *      osu 仍然只能 60。这是 ToS 红线，不是我们可以调的参数。
 *   2. 一次查询只花 **2 个请求**（玩家资料 + 成绩列表），所以每分钟约 30 次查询。
 *   3. 超过就明确告诉用户「稍后再试」，**不要偷偷用别的源**。
 *
 * ── 数据形状 ────────────────────────────────────────────────────────
 *
 * 上游返回的 Score 对象字段很多且部分可为 null；这里**一律容错**，
 * 宁可给 0 或空串，也不让一个缺字段把整页打崩。
 */

import {
  OSU_RULESET_LABEL,
  type OsuBests,
  type OsuPlayer,
  type OsuRuleset,
  type OsuScore,
  LxnsError,
} from '@astramai/core';

import type { DataSource, PlayerQuery, RawLibrary, SourceDescriptor } from './types.js';
import type { UpstreamLimiter } from './upstream-limiter.js';

const API_BASE = 'https://osu.ppy.sh/api/v2';
const TOKEN_URL = 'https://osu.ppy.sh/oauth/token';

/**
 * ToS 给的硬上限。**不要调高。**
 *
 * 60 是官方明写的「不要超过」，超了可能被吊销 token。
 * 留一点余量（50）给瞬时抖动，因为我们没法保证自己的计数和上游完全同步。
 */
const HARD_LIMIT_PER_MINUTE = 50;

/** token 提前多久刷新。留一分钟，避免请求正好卡在过期瞬间。 */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface OsuSourceOptions {
  clientId: string;
  clientSecret: string;
  limiter: UpstreamLimiter;
  /** 默认玩法。 */
  ruleset?: OsuRuleset;
  /** 一次取多少条成绩（上游上限 100，默认 50）。 */
  bestLimit?: number;
  /** 注入 fetch，方便测试。 */
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class OsuSource implements DataSource {
  readonly id = 'osu';
  readonly label = 'osu! 官方 API';
  readonly games = ['osu'] as const;

  /**
   * ToS 规定的硬上限。注册表会用 `min(全局预算, 这个值)`。
   *
   * 和 `upstreamLimitPerMinute` 的关系是**取小**：全局预算是所有源共享的
   * 成本控制，而这个是上游明写的红线，两个都得守。
   */
  readonly hardLimitPerMinute = HARD_LIMIT_PER_MINUTE;

  private token: CachedToken | null = null;
  /**
   * 正在进行中的 token 请求。
   *
   * 见 `getToken` 里的说明：并发时**必须复用同一个 promise**，
   * 否则两个并发请求会各自换一次 token，白烧配额。
   */
  private tokenPromise: Promise<CachedToken> | null = null;
  private readonly ruleset: OsuRuleset;
  private readonly bestLimit: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OsuSourceOptions) {
    this.ruleset = options.ruleset ?? 'osu';
    // 上游上限 100。多取没有意义，pp 越往后越小。
    this.bestLimit = Math.min(Math.max(options.bestLimit ?? 50, 1), 100);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  describe(): SourceDescriptor {
    return {
      id: this.id,
      label: this.label,
      games: this.games,
      requiresKey: true,
      available: true,
      unavailableReason: undefined,
    };
  }

  /** osu! 用用户名定位玩家。好友码 / QQ 号都不适用。 */
  supports(query: PlayerQuery): boolean {
    return typeof query.username === 'string' && query.username.trim().length > 0;
  }

  // ── 舞萌接口：这个源不支持 ──────────────────────────────────────────

  /*
   * `DataSource` 的 `getPlayer` / `getBests` 是**舞萌的形状**
   * （返回 `MaimaiPlayer` / `MaimaiBests`，里面有 `standard_total` / `dx_total`）。
   * osu! 的评级是 pp、成绩是 play 列表，硬塞进去只会让调用方拿到一堆假字段。
   *
   * 所以这里明确拒绝，真正的接口是下面的 `getOsuPlayer` / `getOsuBests`——
   * 和中二那套 `getChunithmPlayer` / `getChunithmBests` 是同一个模式。
   */
  getPlayer(): Promise<never> {
    return Promise.reject(this.unsupported('舞萌玩家信息'));
  }

  getBests(): Promise<never> {
    return Promise.reject(this.unsupported('舞萌 Best 50'));
  }

  fetchLibrary(): Promise<RawLibrary> {
    return Promise.reject(this.unsupported('舞萌曲库'));
  }

  private unsupported(what: string): LxnsError {
    return new LxnsError('bad-request', `osu! 数据源不提供${what}`, {
      friendly: `osu! 数据源不提供${what}，请把数据源切回落雪或自建 net。`,
    });
  }

  // ── osu! 接口 ───────────────────────────────────────────────────────

  async getOsuPlayer(query: PlayerQuery): Promise<OsuPlayer> {
    const username = this.requireUsername(query);
    const raw = await this.api(`/users/${encodeURIComponent(username)}/${this.ruleset}`);
    return mapPlayer(raw, this.ruleset);
  }

  async getOsuBests(query: PlayerQuery, limitOverride?: number): Promise<OsuBests> {
    const username = this.requireUsername(query);

    // 调用方可以临时覆盖条数（调试用），但**不能超过上游上限 100**
    const limit =
      typeof limitOverride === 'number' && limitOverride > 0
        ? Math.min(limitOverride, 100)
        : this.bestLimit;

    this.options.limiter.spend(2, this.label);

    const encoded = encodeURIComponent(username);

    /*
     * ⚠️ **必须分两步，不能并发。**
     *
     * 实测（2026-10-18）：
     *   GET /users/mrekk/osu               → 200   ← 资料认可用户名
     *   GET /users/mrekk/scores/best       → 404   ← 成绩**不认用户名**
     *   GET /users/@mrekk/scores/best      → 404   ← @ 前缀也不行
     *   GET /users/7562902/scores/best     → 200   ← 只认数字 ID
     *
     * 所以先查资料拿 `id`，再用 id 查成绩。两次请求，但**有先后依赖**，
     * 不能像原来那样 `Promise.all` 并发。
     *
     * 这个差异文档里没写清楚（也可能写在被截断的部分），是靠试探端点发现的。
     */
    const playerRaw = await this.api(`/users/${encoded}/${this.ruleset}`);
    const player = mapPlayer(playerRaw, this.ruleset);

    if (!player.id) {
      // 没有 ID 就没法查成绩。正常不会发生（资料里一定有 id），
      // 但真发生了要给出人话而不是拼一个 `/users/0/scores/best` 去打 404。
      throw new LxnsError('server', 'osu! 玩家资料里没有 id', {
        friendly: 'osu! 返回的玩家资料不完整，请稍后再试。',
      });
    }

    const scoresRaw = await this.api(
      `/users/${player.id}/scores/best?mode=${this.ruleset}&limit=${limit}`,
    );

    const scores = Array.isArray(scoresRaw)
      ? scoresRaw.map((item) => mapScore(item)).filter((item) => item !== null)
      : [];

    return {
      player,
      scores: scores as OsuScore[],
      totalPp: player.pp,
      // 上游最多给 100 条，取满了就说明后面可能还有
      truncated: scores.length >= Math.min(limit, 50),
    };
  }

  private requireUsername(query: PlayerQuery): string {
    const username = (query.username ?? '').trim();
    if (!username) {
      throw new LxnsError('bad-request', 'osu! 查询需要用户名', {
        friendly: 'osu! 需要填写用户名（不是好友码）。',
      });
    }
    return username;
  }

  // ── HTTP ────────────────────────────────────────────────────────────

  /**
   * 取 token。
   *
   * **必须缓存**：token 有效 24 小时，每次请求都换会白白消耗配额，
   * 而且 osu! 的 token 接口本身也有限流。
   */
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.token.expiresAt) return this.token.accessToken;

    /*
     * ⚠️ **要缓存 promise，不能只缓存结果。**
     *
     * `getOsuBests` 用 `Promise.all` 并发发两个请求（资料 + 成绩），
     * 它们都会走到这里。此刻 `this.token` 还是 null——只缓存结果的话
     * 两次调用会**各自发一次 token 请求**，白烧一个上游配额。
     *
     * 这个 bug 是测试抓出来的：期望 3 个请求，实际 4 个。
     */
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }

    const fresh = await this.tokenPromise;
    this.token = fresh;
    return fresh.accessToken;
  }

  /** 真正去换 token。并发去重由 `getToken` 负责。 */
  private async fetchToken(): Promise<CachedToken> {
    const now = Date.now();

    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: 'client_credentials',
      scope: 'public',
    });

    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      /*
       * token 拿不到是**配置问题**（client_id/secret 错、或应用被停用），
       * 不是用户的问题。文案要说清方向，别让玩家以为是他们输错了。
       */
      const detail = await safeText(response);
      throw new LxnsError('server', `osu! token 获取失败（HTTP ${response.status}）`, {
        friendly:
          'osu! 服务端认证失败，这是服务器配置问题（OSU_CLIENT_ID / OSU_CLIENT_SECRET），' +
          '不是你的账号问题。请联系维护者。',
        detail,
      });
    }

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    const accessToken = payload.access_token;
    if (!accessToken) {
      throw new LxnsError('server', 'osu! token 响应里没有 access_token', {
        friendly: 'osu! 返回了异常的认证结果，请稍后再试。',
      });
    }

    const ttlMs = (payload.expires_in ?? 86_400) * 1000;
    return {
      accessToken,
      // 提前一分钟刷新，避免正好卡在过期瞬间
      expiresAt: now + Math.max(ttlMs - TOKEN_REFRESH_MARGIN_MS, 60_000),
    };
  }

  private async api(path: string): Promise<unknown> {
    const token = await this.getToken();

    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (response.status === 404) {
      throw new LxnsError('not-found', `osu! 找不到用户（${path}）`, {
        friendly: '这个 osu! 用户名不存在，或者该玩家在这个玩法下没有成绩。',
      });
    }

    if (response.status === 401) {
      // token 被提前吊销了：清掉缓存，让下次重新取
      this.token = null;
      throw new LxnsError('unauthorized', 'osu! token 已失效', {
        friendly: 'osu! 认证失效，请稍后再试（服务端会自动重新获取）。',
      });
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new LxnsError('server', `osu! 返回 HTTP ${response.status}`, {
        friendly: `osu! 暂时没有正常响应（HTTP ${response.status}），请稍后再试。`,
        detail,
      });
    }

    return response.json();
  }
}

// ── 映射 ──────────────────────────────────────────────────────────────

/** 非空对象判断。上游会把很多字段给成 null。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * 玩家资料。
 *
 * 上游 `/users/{user}/{ruleset}` 的形状：
 *   { id, username, country_code, statistics: { global_rank, country_rank, pp, accuracy, play_count } }
 *
 * `statistics` 可能整个缺失（新号），所以逐层容错。
 */
export function mapPlayer(raw: unknown, ruleset: OsuRuleset): OsuPlayer {
  const record = isRecord(raw) ? raw : {};
  const stats = isRecord(record.statistics) ? record.statistics : {};

  return {
    id: num(record.id),
    username: str(record.username, '未知玩家'),
    globalRank: nullableNum(stats.global_rank),
    countryRank: nullableNum(stats.country_rank),
    countryCode: str(record.country_code).toUpperCase(),
    pp: num(stats.pp),
    // 上游给 0–1 的小数；这里**保持原样**，格式化交给展示层
    accuracy: num(stats.accuracy),
    playCount: num(stats.play_count),
    ruleset,
    avatarUrl: str(record.avatar_url),
  };
}

/**
 * 单条成绩。
 *
 * 上游 Score 对象里我们用到的是：
 *   pp            这次成绩的 pp（**可能是 null**，未进榜的谱面）
 *   accuracy      0–1
 *   rank          评级字母
 *   mods          缩写数组
 *   score         游戏内分数
 *   max_combo
 *   weight        { percentage, pp } 加权信息
 *   beatmap       { id, version, difficulty_rating }
 *   beatmapset    { title, artist, covers: { cover } }
 *
 * 任何一项缺失都退回默认值，不抛错——**一条坏数据不该让整页空白**。
 */
export function mapScore(raw: unknown): OsuScore | null {
  if (!isRecord(raw)) return null;

  const weight = isRecord(raw.weight) ? raw.weight : {};
  const beatmap = isRecord(raw.beatmap) ? raw.beatmap : {};
  const beatmapset = isRecord(raw.beatmapset) ? raw.beatmapset : {};
  const covers = isRecord(beatmapset.covers) ? beatmapset.covers : {};

  const pp = num(raw.pp);

  const artist = str(beatmapset.artist);
  const songTitle = str(beatmapset.title);
  const display = artist && songTitle ? `${artist} - ${songTitle}` : songTitle || artist || '未知曲目';

  return {
    pp,
    weightedPp: num(weight.pp),
    weightPercent: num(weight.percentage),
    accuracy: num(raw.accuracy),
    rank: str(raw.rank, '-'),
    mods: Array.isArray(raw.mods)
      ? raw.mods.filter((mod): mod is string => typeof mod === 'string' && mod.length > 0)
      : [],
    score: num(raw.score),
    maxCombo: num(raw.max_combo),

    beatmapId: num(beatmap.id),
    version: str(beatmap.version, '未知难度'),
    starRating: num(beatmap.difficulty_rating),
    // 曲名和艺术家分开存：展示层才知道该合并还是分两行
    songTitle: songTitle || display,
    artist,
    title: display,
    coverUrl: str(covers.cover) || str(covers.list),
  };
}

/** 供配置层展示：某个玩法的人类可读名。 */
export function osuRulesetLabel(ruleset: OsuRuleset): string {
  return OSU_RULESET_LABEL[ruleset];
}
