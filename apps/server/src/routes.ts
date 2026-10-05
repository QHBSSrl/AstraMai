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
  type LxnsErrorKind,
  type MaimaiSong,
  type MaimaiSongDifficulty,
} from '@astramai/core';
import type { ServerResponse } from 'node:http';

import { resolveMode, type ServerConfig } from './config.js';
import { Router, readBody, sendJson, sendText, type RequestContext } from './http.js';
import type { Guard } from './guard.js';
import type { LxnsService } from './lxns-service.js';

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

function parseId(value: string | undefined, label: string): number {
  const digits = (value ?? '').trim();
  if (!/^\d{1,20}$/.test(digits)) {
    throw new LxnsError('bad-request', `${label} 必须是纯数字，收到：${digits || '(空)'}`);
  }
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed)) {
    throw new LxnsError('bad-request', `${label} 超出安全整数范围：${digits}`);
  }
  return parsed;
}

export function createRouter(
  service: LxnsService,
  config: ServerConfig,
  guard: Guard,
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
        upstreamBudget: service.upstreamStatus(),
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

        const result = await service.getB50(
          kind === 'qq'
            ? { qq: value, clientKey, forceMock }
            : { friendCode: value, clientKey, forceMock },
        );

        ok(ctx.res, {
                    mode: result.mode,
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

  // ── 原始透传：玩家信息 ────────────────────────────────────────────────
  const playerHandler =
    (kind: 'friendCode' | 'qq') =>
    async (ctx: RequestContext): Promise<void> => {
      try {
        const raw = kind === 'qq' ? ctx.params.qq : ctx.params.friendCode;
        const value = parseId(raw, kind === 'qq' ? 'QQ 号' : '好友码');
        const clientKey = clientKeyOf(ctx, config);
        const developerKey = clientKey ?? config.apiKey;
        const mode = resolveMode(config, developerKey !== undefined);

        if (mode === 'mock') {
          ok(ctx.res, {
                        mode,
            data: { note: 'Mock 模式不提供玩家信息接口，请使用 /api/maimai/b50/... 获取完整模拟数据。' },
          });
          return;
        }

        const client = new LxnsClient({ developerKey });
        const player = kind === 'qq' ? await client.getPlayerByQq(value) : await client.getPlayer(value);
        ok(ctx.res, { mode, data: player });
      } catch (error) {
        fail(ctx.res, error, ctx.url.pathname);
      }
    };

  router.get('/api/maimai/player/:friendCode', playerHandler('friendCode'));
  router.get('/api/maimai/player/qq/:qq', playerHandler('qq'));

  // ── 曲库 ──────────────────────────────────────────────────────────────
  router.get('/api/maimai/songs', async (ctx) => {
    try {
      const withNotes = ctx.query.get('notes') === '1' || ctx.query.get('notes') === 'true';
      const library = await service.getLibrary(clientKeyOf(ctx, config));
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
  });

  router.get('/api/maimai/aliases', async (ctx) => {
    try {
      const library = await service.getLibrary(clientKeyOf(ctx, config));
      ok(ctx.res, { source: library.source, data: library.aliases });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
  });

  /** 曲目搜索：匹配曲名 / 艺术家 / 落雪别名。 */
  router.get('/api/maimai/search', async (ctx) => {
    try {
      const keyword = (ctx.query.get('q') ?? '').trim();
      const limit = Math.min(Math.max(Number.parseInt(ctx.query.get('limit') ?? '30', 10) || 30, 1), 200);
      if (keyword.length === 0) {
        ok(ctx.res, { data: { keyword, results: [] } });
        return;
      }

      const library = await service.getLibrary(clientKeyOf(ctx, config));
      const needle = keyword.toLowerCase();
      const results: {
        id: number;
        title: string;
        artist: string;
        genre: string;
        aliases: string[];
        difficulties: { type: string; difficulty: number; level: string; level_value: number }[];
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
          aliases,
          difficulties: [...(song.difficulties.standard ?? []), ...(song.difficulties.dx ?? [])].map(
            (chart) => ({
              type: chart.type,
              difficulty: chart.difficulty,
              level: chart.level,
              level_value: chart.level_value,
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
        clientKey: clientKeyOf(ctx, config),
      });
      ok(ctx.res, { mode: result.mode, data: result.scores });
    } catch (error) {
      fail(ctx.res, error, ctx.url.pathname);
    }
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
