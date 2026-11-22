#!/usr/bin/env node
/**
 * 内部日志分析站点（本地跑）。
 *
 * ── 为什么在本地 ────────────────────────────────────────────────
 * 这是给内部排查用的，不该对公网开放。日志里可能有用户的好友码、
 * IP、设备标识 —— 放到公网上等于把这些东西贴在门口。
 *
 * ── 数据怎么来 ──────────────────────────────────────────────────
 * 服务端把上报存成 `data/logs/YYYY-MM-DD/<id>.json`，跑在阿里云的
 * Docker 容器里，**目录没有 bind mount 到宿主机**，所以只能在容器内读。
 *
 * 一次 SSH 把整个目录 tar 到 stdout，本地解包 —— 比逐文件 scp 快得多，
 * 而且只用一个连接。
 *
 *     ssh dsh-cloud "docker exec astramai tar czf - -C /app/apps/server/data logs"
 *
 * ── 用法 ────────────────────────────────────────────────────────
 *     node tools/log-viewer/server.mjs
 *     → http://127.0.0.1:8790
 *
 * 页面上点「刷新」会重新拉一次。
 */
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';

const run = promisify(execFile);

const ROOT = import.meta.dirname;
const CACHE = join(ROOT, '.cache');
const PORT = Number(process.env.LOG_VIEWER_PORT || 8790);

/** SSH 别名 —— 见 ~/.ssh/config，指向 101.132.148.117:52778 */
const SSH_ALIAS = process.env.LOG_VIEWER_SSH || 'dsh-cloud';
const CONTAINER = process.env.LOG_VIEWER_CONTAINER || 'astramai';
const REMOTE_DIR = process.env.LOG_VIEWER_DIR || '/app/apps/server/data';

/* ── 拉取 ───────────────────────────────────────────────────────── */

let lastPull = 0;
let lastPullError = '';

/**
 * 从阿里云把日志目录 tar 回来并解包。
 *
 * ⚠️ 用 `execFile` 而不是 `exec`：参数里不带 shell，避免引号地狱。
 * tar 走管道，`-C` 指定容器内的父目录，包内路径就是 `logs/...`。
 */
async function pull() {
  rmSync(CACHE, { recursive: true, force: true });
  mkdirSync(CACHE, { recursive: true });

  try {
    // tar 到 stdout（二进制），用 maxBuffer 放大到 64 MB
    const { stdout } = await run(
      'ssh',
      [
        '-o', 'ConnectTimeout=15',
        '-o', 'BatchMode=yes',
        SSH_ALIAS,
        `docker exec ${CONTAINER} tar czf - -C ${REMOTE_DIR} logs`,
      ],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );

    // gunzip → 存成 tar → 本地展开
    const tarPath = join(CACHE, 'logs.tar');
    const gunzipped = await new Promise((resolve, reject) => {
      const chunks = [];
      const gz = createGunzip();
      gz.on('data', (c) => chunks.push(c));
      gz.on('end', () => resolve(Buffer.concat(chunks)));
      gz.on('error', reject);
      gz.end(stdout);
    });
    writeFileSync(tarPath, gunzipped);

    await run('tar', ['xf', tarPath, '-C', CACHE], { maxBuffer: 16 * 1024 * 1024 });
    rmSync(tarPath, { force: true });

    lastPull = Date.now();
    lastPullError = '';
    return true;
  } catch (error) {
    lastPullError = String(error && error.message ? error.message : error).slice(0, 400);
    console.error('[log-viewer] 拉取失败：', lastPullError);
    return false;
  }
}

/* ── 读缓存 ─────────────────────────────────────────────────────── */

/** 递归收集所有 .json。 */
function collect(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collect(full, out);
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** 读全部报告，按收到时间倒序。 */
function loadReports() {
  const files = collect(join(CACHE, 'logs'));
  const reports = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const r = data && data.report ? data.report : {};
      const entries = Array.isArray(r.entries) ? r.entries : [];
      reports.push({
        // 相对路径当 id，既能定位又不会泄漏绝对路径
        id: file.replace(CACHE + '\\', '').replace(CACHE + '/', '').replace(/\\/g, '/'),
        receivedAt: data.receivedAt || '',
        from: data.from || '',
        device: r.device || '',
        scope: r.scope || '',
        message: r.message || '',
        at: r.at || 0,
        phase: r.phase || '',
        entryCount: entries.length,
        // 第一行错误预览，列表里就能看出是什么事
        preview: entries.length ? String(entries[entries.length - 1].m || '').slice(0, 120) : '',
      });
    } catch {
      // 坏文件跳过，不让一个坏包毁掉整个列表
    }
  }

  reports.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  return reports;
}

function loadReport(id) {
  // 防目录穿越：只允许 logs/ 开头、不含 ..
  if (!id.startsWith('logs/') || id.includes('..')) return null;
  const file = join(CACHE, id);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/* ── HTTP ───────────────────────────────────────────────────────── */

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/api/reports') {
    json(res, 200, {
      ok: true,
      pulledAt: lastPull,
      error: lastPullError,
      reports: loadReports(),
    });
    return;
  }

  if (url.pathname === '/api/report') {
    const id = url.searchParams.get('id') || '';
    const data = loadReport(id);
    if (!data) {
      json(res, 404, { ok: false, message: 'not found' });
      return;
    }
    json(res, 200, { ok: true, data });
    return;
  }

  if (url.pathname === '/api/refresh') {
    const ok = await pull();
    json(res, ok ? 200 : 500, { ok, error: lastPullError, pulledAt: lastPull });
    return;
  }

  // 静态页
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(ROOT, 'public', 'index.html')));
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

// 启动时先拉一次；失败也让服务起来，页面上能看到错误
await pull();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[log-viewer] http://127.0.0.1:${PORT}`);
  console.log(`[log-viewer] 数据源 ${SSH_ALIAS}:${CONTAINER}${REMOTE_DIR}/logs`);
});
