/**
 * API 路由。
 *
 * 对浏览器只暴露三类接口：
 *   1. 聚合接口（/api/maimai/b50/...）—— 一次请求拿到可直接渲染的视图模型
 *   2. 曲库接口（/api/maimai/songs、/aliases、/search）—— 走公共接口，无需鉴权
 *   3. 健康检查（/api/health）—— 告诉前端当前是 live 还是 mock
 *
 * 密钥一律从服务端配置或 `x-lxns-key` 请求头获取，绝不出现在响应里。
 */

import {
  LxnsClient,
  LxnsError,
  serializeLxnsError,
  jacketUrl,
  versionTitleOf,
  normalizeNotes,
  musicUrl,
  chunithmJacketUrl,
  type ChunithmSong,
  type LxnsErrorKind,
  type MaimaiSong,
  type MaimaiSongDifficulty,
} from '@astramai/core';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { resolveMode, type ServerConfig } from './config.js';
import { Router, readBody, sendJson, sendText, type RequestContext } from './http.js';
import type { Guard } from './guard.js';
import type { GatewayService } from './gateway.js';
import type { DiagStore } from './diag.js';
import { POLL_INTERVAL_MS, type PairingService } from './pairing.js';
import type { PhigrosService } from './phigros.js';
import type { DanceCubeSource } from './sources/dancecube.js';

const STATUS_BY_KIND: Record<LxnsErrorKind, number> = {
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'rate-limited': 429,
  server: 502,
  network: 502,
  timeout: 504,
  malformed: 502,
};

/** 从请求头取浏览器临时递交的密钥（仅本地测试用）。 */
function clientKeyOf(ctx: RequestContext, config: ServerConfig): string | undefined {
  if (!config.allowClientKey) return undefined;
  const raw = ctx.req.headers['x-lxns-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 本次请求指定的数据源。
 *
 * 客户端可以带 `?source=` 指定用哪个源；不带就用默认源。
 * 这样将来多源并存时，客户端不需要重新发版就能切换。
 */
function sourceOf(ctx: RequestContext, service: GatewayService): string {
  return (ctx.query.get('source') ?? '').trim() || service.registry.defaultSourceId();
}

/**
 * 成功响应。
 *
 * 刻意同时带 `ok` 与 `success`：
 *   - Web 前端读 `ok`
 *   - `@astramai/core` 的 `unwrapEnvelope` 读 `success`（对齐落雪的信封格式），
 *     所以 Vela 端可以直接用同一个客户端，不需要另一套解析
 */
function ok(res: ServerResponse, payload: Record<string, unknown>): void {
  sendJson(res, 200, { ok: true, success: true, ...payload });
}

/** 带状态码的失败响应。`ok()` 写死了 200，错误码必须走这里。 */
function bad(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { ok: false, success: false, message });
}

function fail(res: ServerResponse, error: unknown, endpoint: string): void {
  const serialized = serializeLxnsError(error, endpoint);
  const status = STATUS_BY_KIND[serialized.kind] ?? 502;
  sendJson(res, status, {
    ok: false,
    success: false,
    // 顶层 message 是给 core 的 LxnsError 用的，它会优先读这个字段
    message: serialized.friendlyMessage,
    error: serialized,
  });
}

/** 读并解析 JSON 请求体；解析失败返回空对象而不是抛错。 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const raw = await readBody(req);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * 从请求头取设备密钥原文。
 *
 * 刻意用请求头而不是 URL 参数：URL 会进访问日志，密钥不该留在日志里。
 */
function readDeviceSecret(req: IncomingMessage): string {
  const value = req.headers['x-device-secret'];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' ? single.trim() : '';
}

function parseId(value: string | undefined, label: string): number {  const digits = (value ?? '').trim();
  if (!/^\d{1,20}$/.test(digits)) {
    throw new LxnsError('bad-request', `${label} 必须是纯数字，收到：${digits || '(空)'}`);
  }
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed)) {
    throw new LxnsError('bad-request', `${label} 超出安全整数范围：${digits}`);
  }
  return parsed;
}

/**
 * 从查询参数读玩家标识（v1 的写法）。
 *
 * 用查询参数而不是路径参数：好友码与 QQ 号共用一个入口，
 * 将来加别的标识方式（比如 OAuth 返回的用户 id）不用新增路径，
 * 客户端也不需要重新发版。
 */
function readPlayerParams(ctx: RequestContext): { friendCode?: number; qq?: number } {
  const rawQq = (ctx.query.get('qq') ?? '').trim();
  if (rawQq) return { qq: parseId(rawQq, 'QQ 号') };

  const rawCode = (ctx.query.get('code') ?? ctx.query.get('friendCode') ?? '').trim();
  if (rawCode) return { friendCode: parseId(rawCode, '好友码') };

  throw new LxnsError('bad-request', '缺少玩家标识', {
    friendly: '请用 ?code=<15 位好友码> 或 ?qq=<QQ 号> 指定要查询的玩家。',
  });
}

/**
 * 把完整的 B50 视图裁成「手表真正会显示的字段」。
 *
 * 依据是 `apps/vela/src/pages/B50/b50.ux` 里 `applyMaimai` 实际读了哪些：
 *
 *   player: rating / tier.label / name
 *   stats : standardTotal / dxTotal / averageLevelValue / computedDelta
 *   entry : title / difficultyShort / levelIndex / levelValue / rating /
 *           achievements / jacketUrl / songVersionTitle
 *
 * 其余二十多个字段（aliases、notes、computedRating、maxRating、headroom、
 * verification、bpm、genre、artist、lastPlayedTime……）手表一个都不看。
 *
 * ⚠️ **改这个函数前先去看 `applyMaimai`。** 少留一个字段，手表上就是一片空白，
 * 而那种 bug 在网页端完全看不出来。
 */
function compactB50View(view: Record<string, unknown>): unknown {
  const player = (view.player ?? {}) as Record<string, unknown>;
  const stats = (view.stats ?? {}) as Record<string, unknown>;

  const pickEntry = (entry: unknown): unknown => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      title: item.title,
      difficultyShort: item.difficultyShort,
      levelIndex: item.levelIndex,
      levelValue: item.levelValue,
      rating: item.rating,
      achievements: item.achievements,
      jacketUrl: item.jacketUrl,
      songVersionTitle: item.songVersionTitle,
    };
  };

  const pickList = (value: unknown): unknown[] =>
    Array.isArray(value) ? value.map(pickEntry) : [];

  return {
    player: {
      name: player.name,
      rating: player.rating,
      tier: player.tier ? { label: (player.tier as Record<string, unknown>).label } : null,
    },
    stats: {
      standardTotal: stats.standardTotal,
      dxTotal: stats.dxTotal,
      averageLevelValue: stats.averageLevelValue,
      computedDelta: stats.computedDelta,
    },
    standard: pickList(view.standard),
    dx: pickList(view.dx),
  };
}

export function createRouter(
  service: GatewayService,
  config: ServerConfig,
  guard: Guard,
  diag: DiagStore,
  pairing: PairingService,
  phigros: PhigrosService,
  dancecube: DanceCubeSource,
): Router {
  const router = new Router();

  // ── 健康检查 ──────────────────────────────────────────────────────────
  router.get('/api/health', (ctx) => {
    let mode: string;
    try {
      mode = resolveMode(config, clientKeyOf(ctx, config) !== undefined);
    } catch {
      mode = 'unconfigured';
    }
    ok(ctx.res, {
      data: {
        service: 'AstraMai server',
        mode,
        modeConfig: config.modeConfig,
        hasServerKey: config.apiKey !== undefined,
        allowClientKey: config.allowClientKey,
        songCache: service.cacheStatus(),
        upstreamBudget: service.registry.upstreamStatus(),
        accessControl: guard.stats(),
        upstream: 'https://maimai.lxns.net/api/v0',
        time: new Date().toISOString(),
      },
    });
  });

  // ── 聚合：B50 ─────────────────────────────────────────────────────────
  const b50Handler =
    (kind: 'friendCode' | 'qq') =>
    async (ctx: RequestContext): Promise<void> => {
      const startedAt = Date.now();
      try {
        const raw = kind === 'qq' ? ctx.params.qq : ctx.params.friendCode;
        const value = parseId(raw, kind === 'qq' ? 'QQ 号' : '好友码');
        const clientKey = clientKeyOf(ctx, config);
        const forceMock = ctx.query.get('mock') === '1' || ctx.query.get('mock') === 'true';

        const result = await service.getB50({
          ...(kind === 'qq' ? { qq: value } : { friendCode: value }),
          sourceId: sourceOf(ctx, service),
          clientKey,
          forceMock,
        });

        ok(ctx.res, {
          mode: result.mode,
          source: result.sourceId,
          usedServerKey: result.usedServerKey,
          librarySource: result.librarySource,
          elapsedMs: Date.now() - startedAt,
          data: result.view,
        });
      } catch (error) {
        fail(ctx.res, error, ctx.url.pathname);
      }
    };

  router.get('/api/maimai/b50/:friendCode', b50Handler('friendCode'));
  router.get('/api/maimai/b50/qq/:qq', b50Handler('qq'));

  // ── 玩家信息 ──────────────────────────────────────────────────────────
  const playerHandler =
    (kind: 'friendCode' | 'qq') =>
    async (ctx: RequestContext): Promise<void> => {
      try {
        const raw = kind === 'qq' ? ctx.params.qq : ctx.params.friendCode;
        const value = parseId(raw, kind === 'qq' ? 'QQ 号' : '好友码');
        const result = await service.getPlayer({
          ...(kind === 'qq' ? { qq: value } : { friendCode: value }),
          sourceId: sourceOf(ctx, service),
          clientKey: clientKeyOf(ctx, config),
        });
        ok(ctx.res, { mode: result.mode, source: result.sourceId, data: result.player });
      } catch (error) {
        fail(ctx.res, error, ctx.url.pathname);
      }
    };

  router.get('/api/maimai/player/:friendCode', playerHandler('friendCode'));
  router.get('/api/maimai/player/qq/:qq', playerHandler('qq'));

  // ── 曲库 ──────────────────────────────────────────────────────────────
  const songsHandler = async (ctx: RequestContext): Promise<void> => {
    try {
      const withNotes = ctx.query.get('notes') === '1' || ctx.query.get('notes') === 'true';
      const library = await service.getLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      ok(ctx.res, {
                source: library.source,
        fetchedAt: new Date(library.fetchedAt).toISOString(),
        data: {
          songs: library.songs.songs.map((song) => compactSong(song, withNotes)),
          genres: library.songs.genres,
          versions: library.songs.versions,
          aliases: Object.fromEntries(library.aliases.aliases.map((a) => [a.song_id, a.aliases])),
        },
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  };

  router.get('/api/maimai/songs', songsHandler);
  router.get('/api/v1/maimai/songs', songsHandler);

  const aliasesHandler = async (ctx: RequestContext): Promise<void> => {
    try {
      const library = await service.getLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      ok(ctx.res, { source: library.source, data: library.aliases });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  };

  router.get('/api/maimai/aliases', aliasesHandler);
  router.get('/api/v1/maimai/aliases', aliasesHandler);

  /** 曲目搜索：匹配曲名 / 艺术家 / 落雪别名。 */
  const searchHandler = async (ctx: RequestContext): Promise<void> => {
    try {
      const keyword = (ctx.query.get('q') ?? '').trim();
      const limit = Math.min(Math.max(Number.parseInt(ctx.query.get('limit') ?? '30', 10) || 30, 1), 200);

      /**
       * 按分类浏览（可选）。
       *
       * 传分类 id，服务端映射成曲目上的 genre 字符串。
       * **走同一个接口、返回同一种形状**，客户端不用为「浏览」单写一套。
       */
      const genreId = (ctx.query.get('genre') ?? '').trim();

      if (keyword.length === 0 && genreId.length === 0) {
        ok(ctx.res, { data: { keyword, results: [] } });
        return;
      }

      const library = await service.getLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));

      // 分类 id → 曲目上的 genre 原始值
      let genreValue: string | null = null;
      if (genreId.length > 0) {
        const found = library.songs.genres.find((g) => String(g.id) === genreId);
        if (!found) {
          bad(ctx.res, 400, `未知的分类 id：${genreId}`);
          return;
        }
        genreValue = found.genre;
      }

      const needle = keyword.toLowerCase();

      /**
       * 版本名解析放在 core 里（`versionTitleOf`），服务端与 B50 共用一份。
       * 那份「按千位取整兜底」的规则踩过一次坑，不该有第二份实现。
       */
      const versions = library.songs.versions;

      /**
       * 分类的「原始值 → 展示名」映射。
       *
       * 曲目上的 `genre` 是原始值：舞萌那边是**日文**
       * （niconicoボーカロイド / ゲームバラエティ），直接给用户看不懂。
       * 中文名在 genres 的 `title` 里。
       * 中二反过来——`genre` 本身就是中文，而 genres 没有 title。
       * 所以两边谁缺都用对方兜底。
       */
      const genreTitles = new Map(
        library.songs.genres.map((g) => [g.genre, g.title || g.genre]),
      );

      const results: {
        id: number;
        title: string;
        artist: string;
        genre: string;
        bpm: number;
        /** 封面图直链（列表尺寸，已裁剪）。手表上直接丢给 <image> 即可。 */
        jacketUrl: string;
        /** 封面图直链（详情页大图尺寸，已裁剪）。 */
        jacketUrlLarge: string;
        /** 试听音频直链（mp3）。 */
        musicUrl: string;
        version: number;
        /** 版本名（如 BUDDiES）。查不到时为 null。 */
        versionTitle: string | null;
        aliases: string[];
        /** 分类的展示名（已映射成中文）。查不到时为 null。 */
        genreTitle: string | null;
        difficulties: {
          type: string;
          difficulty: number;
          level: string;
          level_value: number;
          note_designer: string;
          /**
           * 物量明细。「谱面确认」要用——曲库本来就带这个数据
           * （拉曲库时是 `getSongList({ notes: true })`），之前只是没透出来。
           * BUDDY 谱面的左右手已经在 core 里合并过。
           */
          notes: { total: number; tap: number; hold: number; slide: number; touch: number; break: number } | null;
        }[];
        matchedBy: 'title' | 'artist' | 'alias' | 'genre';
      }[] = [];

      for (const song of library.songs.songs) {
        // 按分类浏览时先过分类；分类不看关键词，所以这里不判 needle
        if (genreValue !== null && song.genre !== genreValue) continue;

        const aliases = library.aliases.aliases.find((a) => a.song_id === song.id)?.aliases ?? [];
        let matchedBy: 'title' | 'artist' | 'alias' | 'genre' | null = null;

        if (genreValue !== null) {
          // 分类浏览：整类都要，不按关键词筛
          matchedBy = 'genre';
        } else if (song.title.toLowerCase().includes(needle)) matchedBy = 'title';
        else if (aliases.some((alias) => alias.toLowerCase().includes(needle))) matchedBy = 'alias';
        else if (song.artist.toLowerCase().includes(needle)) matchedBy = 'artist';
        if (!matchedBy) continue;

        results.push({
          id: song.id,
          genreTitle: genreTitles.get(song.genre) ?? null,
          title: song.title,
          artist: song.artist,
          genre: song.genre,
          bpm: song.bpm,
          jacketUrl: jacketUrl(song.id, 96),
          jacketUrlLarge: jacketUrl(song.id, 192),
          musicUrl: musicUrl(song.id),
          version: song.version,
          versionTitle: versionTitleOf(versions, song.version),
          aliases,
          difficulties: [...(song.difficulties.standard ?? []), ...(song.difficulties.dx ?? [])].map(
            (chart) => ({
              type: chart.type,
              difficulty: chart.difficulty,
              level: chart.level,
              level_value: chart.level_value,
              note_designer: chart.note_designer,
              notes: normalizeNotes(chart.notes),
            }),
          ),
          matchedBy,
        });
        if (results.length >= limit) break;
      }

      ok(ctx.res, { source: library.source, data: { keyword, count: results.length, results } });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  };

  router.get('/api/maimai/search', searchHandler);
  router.get('/api/v1/maimai/search', searchHandler);

  // ── 中二节奏 ──────────────────────────────────────────────────────────
  //
  // 和舞萌共用同一个上游（落雪）、同一把密钥，所以这一整块基本是
  // 照着上面的 maimai 版改路径与字段名。差异只在：
  //   物量是 air/flick（舞萌是 touch/break）
  //   难度有 6 档（舞萌 5 档）
  //   没有 song_type（中二不分 standard/dx）

  /** 压平一首中二曲目。字段名刻意和 compactSong 对齐，客户端可以共用渲染代码。 */
  const compactChunithmSong = (song: ChunithmSong, withNotes: boolean) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    genre: song.genre,
    bpm: song.bpm,
    version: song.version,
    jacketUrl: chunithmJacketUrl(song.id, 96),
    jacketUrlLarge: chunithmJacketUrl(song.id, 192),
    difficulties: song.difficulties.map((chart) => ({
      difficulty: chart.difficulty,
      level: chart.level,
      level_value: chart.level_value,
      note_designer: chart.note_designer,
      version: chart.version,
      // 物量字段是中二特有的 air/flick，不做成和舞萌同名——
      // 硬凑成同名会让「这到底是不是同一个东西」变得说不清
      ...(withNotes && chart.notes ? { notes: chart.notes } : {}),
    })),
  });

  const chunithmSongsHandler = async (ctx: RequestContext): Promise<void> => {
    try {
      const withNotes = ctx.query.get('notes') === '1' || ctx.query.get('notes') === 'true';
      const library = await service.getChunithmLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      ok(ctx.res, {
        source: library.source,
        fetchedAt: new Date(library.fetchedAt).toISOString(),
        data: {
          songs: library.songs.songs.map((song) => compactChunithmSong(song, withNotes)),
          genres: library.songs.genres,
          versions: library.songs.versions,
          aliases: Object.fromEntries(
            library.aliases.aliases.map((item) => [item.song_id, item.aliases]),
          ),
        },
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  };

  router.get('/api/v1/chunithm/songs', chunithmSongsHandler);

  /** 中二曲目搜索：匹配曲名 / 艺术家 / 别名。 */
  const chunithmSearchHandler = async (ctx: RequestContext): Promise<void> => {
    try {
      const keyword = (ctx.query.get('q') ?? '').trim();
      const limit = Math.min(Math.max(Number.parseInt(ctx.query.get('limit') ?? '30', 10) || 30, 1), 100);
      // 分类浏览时不需要关键词
      const genreId = (ctx.query.get('genre') ?? '').trim();
      if (!keyword && !genreId) {
        bad(ctx.res, 400, '缺少查询参数 q（或分类参数 genre）');
        return;
      }

      const library = await service.getChunithmLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      const needle = keyword.toLowerCase();
      const versionTitles = new Map(library.songs.versions.map((v) => [v.version, v.title]));

      /**
       * 中二的分类展示名。
       *
       * **中二和舞萌刚好相反**：中二的 `genre` 本身就是中文
       * （东方Project / 原创 / 彩绿），而且类型上**没有 `title` 字段**——
       * 写 `g.title` 会被 TS 直接报错（TS2339），这条实测结论有类型背书。
       * 舞萌那边 `genre` 是日文、`title` 才是中文。
       *
       * 所以这里直接拿 `genre` 当展示名，不做映射。
       */
      const genreTitles = new Map(library.songs.genres.map((g) => [g.genre, g.genre]));

      // 分类 id → 曲目上的 genre 原始值
      let genreValue: string | null = null;
      if (genreId) {
        const found = library.songs.genres.find((g) => String(g.id) === genreId);
        if (!found) {
          bad(ctx.res, 400, `未知的分类 id：${genreId}`);
          return;
        }
        genreValue = found.genre;
      }

      const results: Record<string, unknown>[] = [];
      for (const song of library.songs.songs) {
        if (genreValue !== null && song.genre !== genreValue) continue;

        const aliases =
          library.aliases.aliases.find((item) => item.song_id === song.id)?.aliases ?? [];
        let matchedBy: 'title' | 'artist' | 'alias' | 'genre' | null = null;
        if (genreValue !== null) matchedBy = 'genre';
        else if (song.title.toLowerCase().includes(needle)) matchedBy = 'title';
        else if (aliases.some((alias) => alias.toLowerCase().includes(needle))) matchedBy = 'alias';
        else if (song.artist.toLowerCase().includes(needle)) matchedBy = 'artist';
        if (!matchedBy) continue;

        results.push({
          ...compactChunithmSong(song, true),
          genreTitle: genreTitles.get(song.genre) ?? null,
          versionTitle: versionTitles.get(song.version) ?? null,
          aliases,
          matchedBy,
        });
        if (results.length >= limit) break;
      }

      ok(ctx.res, { source: library.source, data: { keyword, count: results.length, results } });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  };

  router.get('/api/v1/chunithm/search', chunithmSearchHandler);

  /**
   * 乐曲分类列表。
   *
   * 单独开这个接口是为了**轻量**：手表只想拿 7 个分类名，
   * 没必要为此拉下整份曲库（舞萌 1344 首、中二 1458 首）。
   */
  const genresHandler = (pick: 'maimai' | 'chunithm') => async (ctx: RequestContext): Promise<void> => {
    try {
      const library =
        pick === 'maimai'
          ? await service.getLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config))
          : await service.getChunithmLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      ok(ctx.res, {
        source: library.source,
        data: {
          game: pick,
          genres: library.songs.genres,
          versions: library.songs.versions,
        },
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  };

  router.get('/api/v1/maimai/genres', genresHandler('maimai'));
  router.get('/api/v1/chunithm/genres', genresHandler('chunithm'));

  // ── Phigros ───────────────────────────────────────────────────────────
  //
  // 和落雪那套的根本区别：Phigros 的玩家标识是**一次 TapTap 扫码换来的
  // sessionToken**，没有「按好友码查任何人」的公开入口。
  // 所以这里没有 code/qq 参数，凭证走 `X-Phigros-Session` 请求头。
  //
  // ⚠️ 凭证**刻意不放在 URL 里**：URL 会进访问日志，
  // 而平台的使用条款明确要求不要把 token 写进日志、埋点或错误上报。

  function readPhigrosSession(ctx: RequestContext): string {
    const value = ctx.req.headers['x-phigros-session'];
    const single = Array.isArray(value) ? value[0] : value;
    return typeof single === 'string' ? single.trim() : '';
  }

  /** 生成 TapTap 登录二维码。只回 qrId 与 verificationUrl，**不回 SVG 图**。 */
  router.add('POST', '/api/v1/phigros/qr', async (ctx) => {
    try {
      const version = (ctx.query.get('version') ?? 'cn').toLowerCase() === 'global' ? 'global' : 'cn';
      const qr = await phigros.createQr(version);
      ok(ctx.res, { data: qr });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /** 轮询扫码状态。登录成功后返回 sessionToken（客户端要存好）。 */
  router.get('/api/v1/phigros/qr/:qrId', async (ctx) => {
    try {
      const qrId = (ctx.params.qrId ?? '').trim();
      if (!qrId) {
        bad(ctx.res, 400, '缺少 qrId');
        return;
      }
      const result = await phigros.pollQr(qrId);
      ok(ctx.res, { data: result });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /** Phigros 成绩（RKS + B30）。凭证走请求头。 */
  router.get('/api/v1/phigros/bests', async (ctx) => {
    const startedAt = Date.now();
    try {
      const session = readPhigrosSession(ctx);
      if (!session) {
        bad(ctx.res, 401, '缺少 X-Phigros-Session（请在手表上用 TapTap 扫码登录）');
        return;
      }
      const view = await phigros.getView(session);
      ok(ctx.res, {
        mode: 'live',
        source: 'phigros',
        elapsedMs: Date.now() - startedAt,
        data: view,
      });
    } catch (error) {
      // 错误里绝不能带上 session 本身
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /** Phigros 曲目搜索。平台唯一的曲库入口，没有全量列表。 */
  router.get('/api/v1/phigros/search', async (ctx) => {
    try {
      const keyword = (ctx.query.get('q') ?? '').trim();
      if (!keyword) {
        bad(ctx.res, 400, '缺少查询参数 q');
        return;
      }
      const limit = Math.min(Math.max(Number.parseInt(ctx.query.get('limit') ?? '20', 10) || 20, 1), 50);
      const data = await phigros.searchSongs(keyword, limit);
      ok(ctx.res, { source: 'phigros', data });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /**
   * 中二节奏成绩。
   *
   * 路径用 `bests` 而不是 `b50`：中二不是 B50 那个玩法，
   * 它一次返回 **B30 + Selection10 + Recent10** 三组。
   * 沿用 maimai 的命名会让客户端以为拿到的是同一种东西。
   */
  router.get('/api/v1/chunithm/bests', async (ctx) => {
    const startedAt = Date.now();
    try {
      const { friendCode, qq } = readPlayerParams(ctx);
      const result = await service.getChunithmBests({
        ...(qq !== undefined ? { qq } : { friendCode }),
        sourceId: sourceOf(ctx, service),
        clientKey: clientKeyOf(ctx, config),
        forceMock: ctx.query.get('mock') === '1' || ctx.query.get('mock') === 'true',
      });
      ok(ctx.res, {
        mode: result.mode,
        source: result.sourceId,
        elapsedMs: Date.now() - startedAt,
        data: result.view,
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  // ── osu! ──────────────────────────────────────────────────────────────
  /*
   * 用**用户名**查询，不是好友码——osu! 没有好友码这个概念。
   *
   * ⚠️ 上游限流很紧（osu! ToS：不超过 60 次/分钟，全应用共享），
   * 一次查询花 2 个请求，所以约每分钟 25 次查询。
   * 超了返回 `rate-limited`，客户端应当提示「稍后再试」而不是重试。
   */
  router.get('/api/v1/osu/bests', async (ctx) => {
    const startedAt = Date.now();
    try {
      const username = (ctx.query.get('username') ?? '').trim();
      const rulesetRaw = (ctx.query.get('ruleset') ?? '').trim().toLowerCase();
      const ruleset =
        rulesetRaw === 'osu' ||
        rulesetRaw === 'taiko' ||
        rulesetRaw === 'fruits' ||
        rulesetRaw === 'mania'
          ? rulesetRaw
          : undefined;

      const limitRaw = Number.parseInt(ctx.query.get('limit') ?? '', 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : undefined;

      const result = await service.getOsuBests({
        username,
        ...(ruleset ? { ruleset } : {}),
        ...(limit ? { limit } : {}),
        /*
         * ⚠️ **不能用 `sourceOf`**：它在「没指定 source」时返回**默认源**
         * （通常是 lxns），会把这个请求交给落雪去处理 → 400。
         *
         * osu! 只有一个源，没指定就交给 osu 源自己。
         */
        ...(() => {
          const requested = (ctx.query.get('source') ?? '').trim();
          return requested ? { sourceId: requested } : {};
        })(),
      });

      ok(ctx.res, {
        source: result.sourceId,
        elapsedMs: Date.now() - startedAt,
        data: result.view,
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  // ── 单曲成绩 ──────────────────────────────────────────────────────────
  router.get('/api/maimai/player/:friendCode/song/:songId', async (ctx) => {
    try {
      const friendCode = parseId(ctx.params.friendCode, '好友码');
      const songId = parseId(ctx.params.songId, '曲目 ID');
      const songTypeRaw = ctx.query.get('type');
      const songType =
        songTypeRaw === 'standard' || songTypeRaw === 'dx' || songTypeRaw === 'utage'
          ? songTypeRaw
          : undefined;
      const result = await service.getSongScores({
        friendCode,
        songId,
        ...(songType ? { songType } : {}),
        sourceId: sourceOf(ctx, service),
        clientKey: clientKeyOf(ctx, config),
      });
      ok(ctx.res, { mode: result.mode, data: result.scores });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  // ── v1：对外协议 ──────────────────────────────────────────────────────
  //
  // `/api/maimai/*` 是历史路径，字段形态跟着落雪走，保留它是为了不破坏已有客户端。
  // v1 是**我们自己的协议**：客户端只认这一套，背后接哪个源由服务端决定，
  // 换源不需要客户端改代码。

  /** 协议自述：告诉调用方这是什么、有哪些能力、怎么选源。 */
  router.get('/api/v1', (ctx) => {
    ok(ctx.res, {
      data: {
        name: 'AstraMai API',
        version: 1,
        description: '街机音游数据网关。客户端只认本协议，上游数据源由服务端决定。',
        games: [...new Set(service.registry.list().flatMap((s) => s.games))],
        defaultSource: service.registry.defaultSourceId(),
        endpoints: [
          { method: 'GET', path: '/api/v1', description: '本说明' },
          { method: 'GET', path: '/api/v1/sources', description: '可用数据源及其状态' },
          { method: 'GET', path: '/api/v1/maimai/b50', description: 'Best 50，参数 code 或 qq' },
          { method: 'GET', path: '/api/v1/maimai/player', description: '玩家信息，参数 code 或 qq' },
          { method: 'GET', path: '/api/v1/maimai/songs', description: '曲库，参数 notes=1 带谱面详情' },
          { method: 'GET', path: '/api/v1/maimai/search', description: '曲目搜索，参数 q 与 limit' },
          { method: 'GET', path: '/api/v1/chunithm/songs', description: '中二节奏曲库，参数 notes=1 带物量' },
          { method: 'GET', path: '/api/v1/chunithm/search', description: '中二节奏曲目搜索，参数 q 与 limit' },
          { method: 'GET', path: '/api/v1/chunithm/bests', description: '中二节奏 B30+Selection10+Recent10，参数 code 或 qq' },
        ],
        /** 所有接口都接受 ?source=<id> 指定数据源，不传则用 defaultSource。 */
        sourceParam: 'source',
        /** 响应信封固定为 { ok, success, mode, source, data }。 */
        envelope: { ok: 'boolean', success: 'boolean', mode: 'live|mock', source: '数据源 id', data: '业务数据' },
      },
    });
  });

  // ── 舞立方 ────────────────────────────────────────────────────────────────
  /*
   * 舞立方的登录是**微信扫码 + OAuth**，和 Phigros 同一个模式，但更标准：
   *   · 出码   POST /api/v1/dancecube/qr       → { qrId, qrcodeUrl }
   *   · 轮询   GET  /api/v1/dancecube/qr/:qrId → { status, token }
   *   · 查数据 GET  /api/v1/dancecube/bests    → 凭证走 X-DanceCube-Token
   *
   * 为什么凭证走**请求头**而不是 URL：URL 会进访问日志和 Referer，
   * 而这是玩家的微信身份令牌。Phigros 那边也是这么做的。
   */

  /** 出码。上游一次只给一个，没扫就浪费一个 ID，无所谓。 */
  router.add('POST', '/api/v1/dancecube/qr', async (ctx) => {
    try {
      const qr = await dancecube.createQr();
      ok(ctx.res, { source: 'dancecube', data: { qrId: qr.id, qrcodeUrl: qr.qrcodeUrl } });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /**
   * 轮询。
   *
   * 上游没扫时返回 400，我们把它翻译成 `{ status: 'Pending' }` ——
   * 客户端只需要判断「有没有 token」，不用理解上游的错误码。
   */
  router.get('/api/v1/dancecube/qr/:qrId', async (ctx) => {
    try {
      const qrId = (ctx.params.qrId ?? '').trim();
      if (!qrId) {
        bad(ctx.res, 400, '缺少 qrId');
        return;
      }

      const token = await dancecube.pollToken(qrId);

      if (!token) {
        ok(ctx.res, { source: 'dancecube', data: { status: 'Pending' } });
        return;
      }

      ok(ctx.res, {
        source: 'dancecube',
        data: {
          status: 'Success',
          userId: token.userId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
        },
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /** 读凭证：`X-DanceCube-Token` 头里是 `userId:accessToken`。 */
  function readDanceCubeToken(ctx: RequestContext): {
    userId: number;
    accessToken: string;
    refreshToken: string;
  } | null {
    const raw = ctx.req.headers['x-dancecube-token'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;

    const [userIdText, accessToken] = String(value).split(':');
    const userId = Number(userIdText);
    if (!userId || !accessToken) return null;

    return { userId, accessToken, refreshToken: '' };
  }

  /**
   * 查数据。
   *
   * ⚠️ 一次要 **7 次上游调用**（信息 1 + 曲风 5 + 最近 1），很贵。
   * 缓存放在服务端 —— 5 分钟内同一个 token 只打一次上游。
   */
  const danceCubeCache = new Map<string, { at: number; data: unknown }>();
  const DANCE_CUBE_CACHE_MS = 5 * 60 * 1000;

  router.get('/api/v1/dancecube/bests', async (ctx) => {
    const startedAt = Date.now();
    try {
      const token = readDanceCubeToken(ctx);
      if (!token) {
        bad(ctx.res, 401, '缺少 X-DanceCube-Token（请先用微信扫码登录）');
        return;
      }

      const cacheKey = `${token.userId}:${token.accessToken.slice(-12)}`;
      const cached = danceCubeCache.get(cacheKey);
      if (cached && Date.now() - cached.at < DANCE_CUBE_CACHE_MS) {
        ok(ctx.res, {
          source: 'dancecube',
          cached: true,
          elapsedMs: Date.now() - startedAt,
          data: cached.data,
        });
        return;
      }

      const view = await dancecube.fetchView({
        userId: token.userId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
      });

      danceCubeCache.set(cacheKey, { at: Date.now(), data: view });
      // 别让这个 Map 无限长大
      if (danceCubeCache.size > 200) {
        for (const [key, entry] of danceCubeCache) {
          if (Date.now() - entry.at > DANCE_CUBE_CACHE_MS) danceCubeCache.delete(key);
        }
      }

      ok(ctx.res, {
        source: 'dancecube',
        cached: false,
        elapsedMs: Date.now() - startedAt,
        data: view,
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /** 数据源清单。不可用的源也会列出并说明原因，便于客户端给出提示。 */
  router.get('/api/v1/sources', (ctx) => {
    ok(ctx.res, { data: { sources: service.registry.list() } });
  });

  /** v1 的 B50：用查询参数而不是路径参数，好友码与 QQ 号共用一个入口。 */
  router.get('/api/v1/maimai/b50', async (ctx) => {
    const startedAt = Date.now();
    try {
      const { friendCode, qq } = readPlayerParams(ctx);
      const result = await service.getB50({
        ...(qq !== undefined ? { qq } : { friendCode }),
        sourceId: sourceOf(ctx, service),
        clientKey: clientKeyOf(ctx, config),
        forceMock: ctx.query.get('mock') === '1' || ctx.query.get('mock') === 'true',
      });
      ok(ctx.res, {
        mode: result.mode,
        source: result.sourceId,
        librarySource: result.librarySource,
        elapsedMs: Date.now() - startedAt,
        data: result.view,
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /**
   * 瘦身版 B50 —— **给手环的网桥用的**。
   *
   * ── 为什么需要它 ──────────────────────────────────────────────────
   *
   * 官方 FetchBridge 插件的「单消息模式」有硬上限 16 KB
   * （`MAX_UNCHUNKED_WIRE_LEN`），而我们的完整 B50 实测 **88.6 KB**。
   *
   * 88.6 KB 里绝大部分是手表**根本不显示**的东西：`aliases`（别名数组）、
   * `notes`（物量分项）、`computedRating` / `maxRating` / `headroom`
   * （推分用的中间值）、`verification`、`bpm`、`genre`、`artist`……
   * 单条成绩 32 个字段，手表实际只用 8 个。
   *
   * 所以这里只回那 8 个，估算 50 首约 10 KB —— 塞得进 16 KB。
   *
   * ── 为什么保留原字段名 ────────────────────────────────────────────
   *
   * 本来想用短键名（`t` / `l` / `a`）再省一点，但那样手表渲染层也要改。
   * 保留同样的名字，`applyMaimai` 一行都不用动 —— 只是少了一些它不读的字段。
   *
   * ⚠️ 这个端点**只能给手表用**。网页端要完整数据（别名、物量、推分），
   * 请继续用 `/api/v1/maimai/b50`。
   */
  router.get('/api/v1/maimai/b50/compact', async (ctx) => {
    try {
      const { friendCode, qq } = readPlayerParams(ctx);
      const result = await service.getB50({
        ...(qq !== undefined ? { qq } : { friendCode }),
        sourceId: sourceOf(ctx, service),
        clientKey: clientKeyOf(ctx, config),
      });

      const view = result.view as unknown as Record<string, unknown>;
      ok(ctx.res, {
        mode: result.mode,
        source: result.sourceId,
        compact: true,
        data: compactB50View(view),
      });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  router.get('/api/v1/maimai/player', async (ctx) => {
    try {
      const { friendCode, qq } = readPlayerParams(ctx);
      const result = await service.getPlayer({
        ...(qq !== undefined ? { qq } : { friendCode }),
        sourceId: sourceOf(ctx, service),
        clientKey: clientKeyOf(ctx, config),
      });
      ok(ctx.res, { mode: result.mode, source: result.sourceId, data: result.player });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  // ── 端上报诊断 ────────────────────────────────────────────────────────
  //
  // 真机拿不到日志：Vela 的官方「真机调试」只支持 Watch S4 且仅对合作方开放，
  // 普通手表既没有调试小尾巴也连不上 AIoT-IDE。所以让 App 自己把
  // 「走到哪一步 / 报了什么错」打回服务端，开发者这边才看得到。

  /** 接收上报。客户端 fire-and-forget，失败也不影响它自己。 */
  router.add('POST', '/api/diag', async (ctx) => {
    const body = await readBody(ctx.req);
    let payload: Record<string, unknown> = {};
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      // 不是 JSON 就当作纯文本消息，总比丢掉强
      payload = { message: body.slice(0, 500) };
    }

    const forwarded = ctx.req.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const from =
      (typeof forwardedValue === 'string' ? forwardedValue.split(',')[0]?.trim() : '') ||
      ctx.req.socket.remoteAddress ||
      'unknown';

    const entry = diag.record({
      from,
      event: String(payload.event ?? 'unknown').slice(0, 80),
      message: String(payload.message ?? '').slice(0, 1000),
      stack: String(payload.stack ?? '').slice(0, 4000),
      extra: String(payload.extra ?? '').slice(0, 1000),
    });

    ok(ctx.res, { data: { received: true, at: entry.at } });
  });

  /** 读取上报。用于开发者在服务器上排查真机问题。 */
  router.get('/api/diag', (ctx) => {
    const since = (ctx.query.get('since') ?? '').trim();
    const limit = Number.parseInt(ctx.query.get('limit') ?? '200', 10) || 200;
    const entries = diag.list(since || undefined, limit);
    ok(ctx.res, {
      data: {
        count: entries.length,
        file: diag.file,
        entries,
      },
    });
  });

  /** 清空。排查完一轮之后重置，避免旧信息干扰。 */
  router.add('POST', '/api/diag/clear', (ctx) => {
    const cleared = diag.clear();
    ok(ctx.res, { data: { cleared } });
  });

  // ── 设备配对 ──────────────────────────────────────────────────────────
  //
  // 手表上没有好用的输入法，让玩家在手表上敲好友码/QQ 号很难受。
  // 改成：手表显示一个 8 位 token，玩家在网页上填数据，手表凭 token 去取。
  //
  // 完整的威胁模型和「为什么做不到端到端加密」写在 pairing.ts 的注释里。

  /** 手表发起配对，拿到 token。只上报设备密钥的哈希，原文不出设备。 */
  router.add('POST', '/api/pair/start', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const deviceSecretHash = String(body.deviceSecretHash ?? '').trim();

    if (!/^[0-9a-f]{64}$/.test(deviceSecretHash)) {
      bad(ctx.res, 400, 'deviceSecretHash 必须是 64 位十六进制（SHA256）');
      return;
    }

    const session = pairing.start(deviceSecretHash);
    ok(ctx.res, {
      data: {
        token: session.token,
        expiresAt: session.expiresAt,
        pollIntervalMs: POLL_INTERVAL_MS,
        ttlMs: session.expiresAt - session.createdAt,
      },
    });
  });

  /** 网页把玩家数据提交上来。 */
  router.add('POST', '/api/pair/submit', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const token = String(body.token ?? '').trim();
    const payload = String(body.payload ?? '');
    const pin = body.pin === undefined || body.pin === null ? undefined : String(body.pin);

    if (!/^\d{8}$/.test(token)) {
      bad(ctx.res, 400, 'token 必须是 8 位数字');
      return;
    }
    if (!payload) {
      bad(ctx.res, 400, 'payload 不能为空');
      return;
    }
    // 载荷在客户端就已经压成一行短文本，超过这个长度必然是异常调用
    if (payload.length > 4096) {
      bad(ctx.res, 413, 'payload 过长');
      return;
    }

    const result = pairing.submit(token, payload, pin);
    // 失败原因要做成对玩家可读的（网页要直接提示）
    const MESSAGES: Record<string, string> = {
      'not-found': 'token 不存在，请确认手表上显示的数字',
      expired: 'token 已过期，请在手表上重新获取',
      'pin-required': '该设备已开启传输密码，请输入密码',
      'pin-wrong': '传输密码不正确',
      'too-many-failures': '失败次数过多，该 token 已作废',
    };

    ok(ctx.res, {
      data: result.ok
        ? { ok: true, pinSet: result.pinSet }
        : { ok: false, error: result.error, message: MESSAGES[result.error] ?? '提交失败' },
    });
  });

  /** 手表轮询。**必须带设备密钥原文**——只凭 token 读不走数据。 */
  router.get('/api/pair/poll', (ctx) => {
    const token = (ctx.query.get('token') ?? '').trim();
    const deviceSecret = readDeviceSecret(ctx.req);
    if (!deviceSecret) {
      bad(ctx.res, 400, '缺少设备密钥');
      return;
    }
    if (!/^\d{8}$/.test(token)) {
      bad(ctx.res, 400, 'token 格式不对');
      return;
    }

    const result = pairing.poll(token, deviceSecret);
    ok(ctx.res, { data: result });
  });

  /** 手表取走数据后要求服务端立刻删除——这是玩家的明确诉求。 */
  router.add('POST', '/api/pair/consume', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const token = String(body.token ?? '').trim();
    const deviceSecret = readDeviceSecret(ctx.req) || String(body.deviceSecret ?? '');

    const removed = Boolean(deviceSecret) && /^\d{8}$/.test(token) && pairing.consume(token, deviceSecret);
    ok(ctx.res, { data: { removed } });
  });

  /** 查这个 token 对应的设备有没有开 2FA，网页用来决定要不要显示密码框。 */
  router.get('/api/pair/state', (ctx) => {
    const token = (ctx.query.get('token') ?? '').trim();
    if (!/^\d{8}$/.test(token)) {
      bad(ctx.res, 400, 'token 格式不对');
      return;
    }
    const session = pairing.get(token);
    ok(ctx.res, {
      data: {
        exists: Boolean(session),
        hasPin: session ? pairing.hasPin(token) : false,
        expiresAt: session ? session.expiresAt : null,
      },
    });
  });

  // ── 兜底 ──────────────────────────────────────────────────────────────
  router.add('POST', '/api/echo', async (ctx) => {
    const body = await readBody(ctx.req);
    ok(ctx.res, { data: { length: body.length } });
  });

  return router;
}

/** 裁剪曲目数据：去掉前端用不到的字段，显著减小传输体积。 */
export function compactSong(song: MaimaiSong, withNotes: boolean): unknown {
  const mapChart = (chart: MaimaiSongDifficulty) => ({
    type: chart.type,
    difficulty: chart.difficulty,
    level: chart.level,
    level_value: chart.level_value,
    note_designer: chart.note_designer,
    version: chart.version,
    ...(withNotes && chart.notes ? { notes: chart.notes } : {}),
  });

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    genre: song.genre,
    bpm: song.bpm,
    version: song.version,
    disabled: song.disabled === true,
    difficulties: {
      standard: (song.difficulties?.standard ?? []).map(mapChart),
      dx: (song.difficulties?.dx ?? []).map(mapChart),
      ...(song.difficulties?.utage
        ? {
            utage: song.difficulties.utage.map((chart) => ({
              ...mapChart(chart),
              kanji: chart.kanji,
              description: chart.description,
              is_buddy: chart.is_buddy,
            })),
          }
        : {}),
    },
  };
}

/** 未匹配任何路由时的响应。 */
export function notFound(res: ServerResponse, pathname: string): void {
  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, {
      ok: false,
      error: { kind: 'not-found', message: `没有这个接口：${pathname}`, friendlyMessage: '接口不存在。' },
    });
    return;
  }
  sendText(res, 404, 'Not Found');
}
