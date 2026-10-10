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

export function createRouter(
  service: GatewayService,
  config: ServerConfig,
  guard: Guard,
  diag: DiagStore,
  pairing: PairingService,
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
      if (keyword.length === 0) {
        ok(ctx.res, { data: { keyword, results: [] } });
        return;
      }

      const library = await service.getLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      const needle = keyword.toLowerCase();

      /**
       * 版本名解析放在 core 里（`versionTitleOf`），服务端与 B50 共用一份。
       * 那份「按千位取整兜底」的规则踩过一次坑，不该有第二份实现。
       */
      const versions = library.songs.versions;

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
        matchedBy: 'title' | 'artist' | 'alias';
      }[] = [];

      for (const song of library.songs.songs) {
        const aliases = library.aliases.aliases.find((a) => a.song_id === song.id)?.aliases ?? [];
        let matchedBy: 'title' | 'artist' | 'alias' | null = null;
        if (song.title.toLowerCase().includes(needle)) matchedBy = 'title';
        else if (aliases.some((alias) => alias.toLowerCase().includes(needle))) matchedBy = 'alias';
        else if (song.artist.toLowerCase().includes(needle)) matchedBy = 'artist';
        if (!matchedBy) continue;

        results.push({
          id: song.id,
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
      if (!keyword) {
        bad(ctx.res, 400, '缺少查询参数 q');
        return;
      }

      const library = await service.getChunithmLibrary(sourceOf(ctx, service), clientKeyOf(ctx, config));
      const needle = keyword.toLowerCase();
      const versionTitles = new Map(library.songs.versions.map((v) => [v.version, v.title]));

      const results: Record<string, unknown>[] = [];
      for (const song of library.songs.songs) {
        const aliases =
          library.aliases.aliases.find((item) => item.song_id === song.id)?.aliases ?? [];
        let matchedBy: 'title' | 'artist' | 'alias' | null = null;
        if (song.title.toLowerCase().includes(needle)) matchedBy = 'title';
        else if (aliases.some((alias) => alias.toLowerCase().includes(needle))) matchedBy = 'alias';
        else if (song.artist.toLowerCase().includes(needle)) matchedBy = 'artist';
        if (!matchedBy) continue;

        results.push({
          ...compactChunithmSong(song, true),
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
