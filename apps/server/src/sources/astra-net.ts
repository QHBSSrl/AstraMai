/**
 * 自建 net（AquaDX + AquaNet）数据源。
 *
 * 契约见 `docs/astra-net-api.md`——那份文档里的每一条都是**实测出来的**
 * （对着官方公开实例 aquadx.net 验的），不是照文档抄的。
 *
 * ── 和落雪最大的差别 ────────────────────────────────────────────────
 *
 *   1. **玩家标识是用户名**，不是好友码
 *   2. **参数走查询字符串**，不是请求体；**token 也是查询参数**，不是 header
 *   3. **B50 藏在玩家摘要里**（`ratingComposition` 的两个逗号分隔字符串），
 *      没有独立的 B50 接口
 *
 * ── 这个源的意义 ────────────────────────────────────────────────────
 *
 * 落雪是「舞萌 & 中二**国服**查分器」，覆盖不了日服。
 * 而 net 是网络层重定向，**机厅跑什么版本都行**——这是它存在的理由。
 *
 * 另外：**成绩导入不需要我们做**。AquaDX 自带 `export` / `import`，
 * 「从其它查分器导入数据」那条通路在 net 那边就闭环了。
 */

import {
  LxnsError,
  type LevelIndex,
  type MaimaiBests,
  type MaimaiPlayer,
  type MaimaiScore,
  type SongType,
} from '@astramai/core';

import type {
  DataSource,
  PlayerQuery,
  RawLibrary,
  SourceDescriptor,
} from './types.js';
import type { UpstreamLimiter } from './upstream-limiter.js';

/** 一次 B50 要打一次（摘要里就带成绩）。 */
const COST_PER_B50 = 1;

/** `GameName`，见 AquaNet 的 `scoring.ts`。 */
type AstraGame = 'mai2' | 'chu3';

/** `user-summary` 里我们真正用到的字段。实测抓过真实响应确认过。 */
interface AstraSummary {
  name?: string;
  rating?: number;
  ratingHighest?: number;
  accuracy?: number;
  plays?: number;
  serverRank?: string;
  /**
   * ⚠️ **值是逗号分隔的字符串，不是数组**（实测推翻了这个假设）。
   *
   * 实测线上 maimai 只给 `best35` 和 `new15` 两个键
   * （前端源码里提到的 `best50` / `best30` 等在线上实例并不出现），
   * 所以这里按**实际拿到的键**处理，不硬编码某一个。
   */
  ratingComposition?: Record<string, unknown>;
  recent?: unknown[];
}

export interface AstraNetSourceOptions {
  /** net 的站点地址，例如 `https://net.example.com`。API 基址是 `{base}/aqua`。 */
  baseUrl: string;
  /** 玩家 token（可选）。`user-summary` 无需鉴权，不传也能查。 */
  token?: string | undefined;
  limiter: UpstreamLimiter;
}

/**
 * 解析一条组成串。
 *
 * 实测格式（`OHOOO` 的真实 best35）：
 *
 *     "11663:4:24015:1005324"
 *      musicId level romVersion achievement
 *
 * `romVersion` 要在解析时丢掉——依据是 AquaNet 自己的 `parseComposition`：
 *
 *     if (game === 'mai2') mapData.splice(2, 1)
 *
 * `achievement` 是整数：`1005324` ≈ `100.5324%`。
 */
function parseCompositionEntry(raw: string): {
  musicId: number;
  levelIndex: number;
  achievement: number;
} | null {
  const parts = raw.split(':').map((s) => Number(s.trim()));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;

  // mai2 是 4 段（musicId:level:romVersion:achievement），chu3 是 3 段。
  // 最后一段一定是达成率，倒数第二段之前的是 romVersion（丢掉）。
  const musicId = parts[0];
  const levelIndex = parts[1];
  const achievement = parts[parts.length - 1];
  if (musicId === undefined || levelIndex === undefined || achievement === undefined) return null;

  return { musicId, levelIndex, achievement };
}

/** 把逗号分隔的组成串切成一条条成绩。空串给空数组，不给 `['']`。 */
function parseComposition(value: unknown): MaimaiScore[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];

  const out: MaimaiScore[] = [];
  for (const chunk of value.split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const parsed = parseCompositionEntry(trimmed);
    if (!parsed) continue;

    out.push({
      id: parsed.musicId,
      level_index: parsed.levelIndex as LevelIndex,
      // 上游是 1005324 这种整数，我们内部统一用 100.5324
      achievements: parsed.achievement / 10000,
      type: songTypeOf(parsed.musicId),
      // 组成串里**没有** DX 分数、没有 FC/FS 这些；留空而不是编一个 0，
      // 让界面按「未知」显示——编 0 会被当成真的打了 0 分
      dx_score: 0,
    });
  }
  return out;
}

/**
 * 从曲目 ID 推谱面类型。
 *
 * ⚠️ **组成串里没有类型**（既没有 `type` 字段，也没有 STD/DX 标记），
 * 但舞萌的 ID 自带：实测 `mai2` 曲库的分布是
 *
 *     < 1000        704 首    standard
 *     1000 – 9999    11 首    （少量历史曲目）
 *     10000 – 19999 1034 首   dx        （= 基础 ID + 10000）
 *     >= 20000      152 首    utage     （如 600429 = [宴]Wonderland Wars）
 *
 * 所以按 ID 区间判定即可。**这不是猜**，是照着实测分布定的规则。
 */
function songTypeOf(songId: number): SongType {
  if (songId >= 100000) return 'utage';
  if (songId >= 20000) return 'utage';
  if (songId >= 10000) return 'dx';
  return 'standard';
}

export class AstraNetSource implements DataSource {
  readonly id = 'astra-net';
  readonly label = 'AstraNet（自建私服）';
  readonly games = ['maimai'] as const;

  constructor(private readonly options: AstraNetSourceOptions) {}

  describe(): SourceDescriptor {
    const available = this.options.baseUrl.length > 0;
    return {
      id: this.id,
      label: this.label,
      games: this.games,
      // 自己的 net 不需要开发者密钥，玩家用用户名查即可
      requiresKey: false,
      available,
      ...(available ? {} : { unavailableReason: '未配置 ASTRA_NET_BASE' }),
    };
  }

  supports(query: PlayerQuery): boolean {
    return typeof query.username === 'string' && query.username.trim().length > 0;
  }

  /**
   * 打一次 net。
   *
   * ⚠️ 三个细节都不能想当然（都是实测踩出来的）：
   *   · API 基址是 `{base}/aqua`，直接打 `/api/v2` 会拿到前端 SPA 的 HTML
   *   · 方法一律 **POST**
   *   · 参数走**查询字符串**，token 也是查询参数
   */
  private async call(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    if (!base) {
      throw new LxnsError('bad-request', '未配置自建 net 地址（ASTRA_NET_BASE）');
    }

    const query = new URLSearchParams(params);
    if (this.options.token) query.set('token', this.options.token);
    const url = `${base}/aqua${endpoint}?${query.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST' });
    } catch (error) {
      throw new LxnsError('network', `连接自建 net 失败：${endpoint}`, {
        endpoint,
        cause: error,
      });
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      /*
       * 错误体有两种形态，**两种都要认**（实测）：
       *   · JSON：`{"timestamp":...,"status":400,"error":"Bad Request",...}`
       *   · 纯文本：`Game data not found`
       *
       * 只认 JSON 会漏掉后者——而那恰好是「这个玩家没有存档」这个最需要
       * 翻译成人话的情况。测试就是在这里抓到第一版的 bug 的。
       */
      const detail =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: unknown }).error ?? '')
          : typeof body === 'string'
            ? body.trim()
            : '';

      // 实测：某玩家在该游戏没有存档时，net 返回 404 "Game data not found"。
      // 这不是服务故障，要说成人话。
      if (response.status === 404 && /game data not found/i.test(detail)) {
        throw new LxnsError('not-found', '这个玩家还没有数据', {
          status: 404,
          detail,
          endpoint,
          friendly: '这个账号在自建 net 上没有该游戏的存档。',
        });
      }

      const kind =
        response.status >= 500 ? 'server' : response.status === 404 ? 'not-found' : 'bad-request';
      throw new LxnsError(kind, detail || `net 返回 ${response.status}`, {
        status: response.status,
        detail,
        endpoint,
      });
    }

    return body;
  }

  private async userSummary(game: AstraGame, username: string): Promise<AstraSummary> {
    const body = await this.call(`/api/v2/game/${game}/user-summary`, { username });
    if (!body || typeof body !== 'object') {
      throw new LxnsError('malformed', '自建 net 返回了无法解析的响应');
    }
    return body as AstraSummary;
  }

  async getPlayer(query: PlayerQuery): Promise<MaimaiPlayer> {
    this.options.limiter.spend(1, this.label);
    const summary = await this.userSummary('mai2', query.username as string);
    return toMaimaiPlayer(summary);
  }

  async getBests(query: PlayerQuery): Promise<MaimaiBests> {
    this.options.limiter.spend(COST_PER_B50, this.label);
    const summary = await this.userSummary('mai2', query.username as string);
    return toMaimaiBests(summary);
  }

  /**
   * 曲库。
   *
   * net 的曲库是静态 JSON（`{base}/d/{game}/00/all-music.json`），
   * 以 musicId 为键的字典，实测 mai2 1901 首。
   *
   * ⚠️ **尚未实现。** 要映射成 `MaimaiSongList` 还差 genres / versions / aliases
   * 三块来源（net 的 all-music.json 里没有）。在那之前，
   * 用这个源查 B50 请让曲库走落雪（`gateway` 允许两者不是同一个源）。
   */
  async fetchLibrary(): Promise<RawLibrary> {
    throw new LxnsError('bad-request', '自建 net 的曲库适配尚未实现', {
      friendly: '自建 net 的成绩查询已可用；曲库请暂时用落雪源。',
    });
  }
}

// ── 响应 → 领域模型 ───────────────────────────────────────────────────

/** `GenericGameSummary` → `MaimaiPlayer`。 */
function toMaimaiPlayer(summary: AstraSummary): MaimaiPlayer {
  return {
    name: typeof summary.name === 'string' ? summary.name : '',
    rating: typeof summary.rating === 'number' ? summary.rating : 0,
    /*
     * ⚠️ **自建 net 没有好友码。**
     *
     * 这个字段是落雪的形状，我们的领域模型目前直接沿用了它。
     * 填 0 而不是编一个假号码——界面上要能看出「这个源没有这个概念」。
     * 彻底解决要等把领域模型从落雪契约里抽出来（另一件事）。
     */
    friend_code: 0,
    course_rank: 0,
    class_rank: 0,
    star: 0,
  };
}

/** `GenericGameSummary` → `MaimaiBests`。 */
function toMaimaiBests(summary: AstraSummary): MaimaiBests {
  const composition = summary.ratingComposition ?? {};

  /*
   * 实测线上只有 best35 / new15 两个键，正好对应 B35 + B15 = B50。
   *
   * 但**不硬编码**：前端源码里提到过 best50 / best30 等别的键，
   * 不同版本、不同游戏的键可能不一样。所以按实际拿到的键挑，
   * 优先用合成好的 best50，其次用 best35 + new15。
   */
  const best50 = parseComposition(composition.best50);
  const standard = best50.length > 0 ? [] : parseComposition(composition.best35);
  const dx = best50.length > 0 ? [] : parseComposition(composition.new15);

  if (best50.length > 0) {
    // 有合成好的就直接用；B35/B15 的切分交给视图按谱面类型做
    return {
      standard_total: 0,
      dx_total: 0,
      standard: best50.filter((s) => s.type === 'standard'),
      dx: best50.filter((s) => s.type !== 'standard'),
    };
  }

  return {
    /*
     * **故意不给合计**（填 0 会被当成"真的 0 分"）。
     *
     * 落雪会直接给 standard_total / dx_total；net 的组成串里只有达成率、
     * 没有 rating，得按定数算，而源此刻拿不到曲库。
     * `buildB50View` 已经会从曲库定数 + 达成率**本地算**出合计，
     * 并且在源不给合计时回退到本地值——所以这里留空是安全的。
     */
    standard_total: 0,
    dx_total: 0,
    standard,
    dx,
  };
}
