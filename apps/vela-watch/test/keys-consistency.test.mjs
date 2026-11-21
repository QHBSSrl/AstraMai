/**
 * 跨页面 storage 键的**一致性测试**。
 *
 * ── 为什么值得写 ────────────────────────────────────────────────────
 *
 * 页面之间靠 storage 传数据。键是字符串，写错一个字母不会报错 ——
 * 只会"读不到数据"，表现得像功能没做。
 *
 * 这个测试做两件事：
 *
 *   1. `keys.js` 里的键和值符合约定（比如 `b50CacheKey` 必须带 game 和 code）
 *   2. **页面里不许再硬编码这些键** —— 必须从 `keys.js` 取
 *
 * 第 2 条是关键：它防的不是"现在写错"，而是"以后有人图省事又写死一个"。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  B50_CACHE_INDEX_KEY,
  B50_DIFF_KEY,
  CURRENT_GAME_KEY,
  PUSH_SEED_KEY,
  QUERY_KIND_KEY,
  QUERY_VALUE_KEY,
  b50CacheAtKey,
  b50CacheKey,
} from '../src/common/keys.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

/** 这些键被 pages 硬编码过，抽出来之后不该再出现在页面里。 */
const SHARED_KEYS = [B50_DIFF_KEY, PUSH_SEED_KEY];

/** 递归收集 `.ux` / `.js` 文件（跳过 keys.js 自己）。 */
function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    if (!/\.(ux|js)$/.test(name)) continue;
    if (name === 'keys.js') continue;
    out.push(full);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// keys.js 自身的约定
// ══════════════════════════════════════════════════════════════════════

test('b50CacheKey 把 game 和 code 都编进去', () => {
  assert.equal(b50CacheKey('maimai', '123'), 'b50Cache:maimai:123');
  // 不同玩家必须不同 —— 否则会看到别人的成绩
  assert.notEqual(b50CacheKey('maimai', '123'), b50CacheKey('maimai', '456'));
  // 不同游戏必须不同
  assert.notEqual(b50CacheKey('maimai', '123'), b50CacheKey('chunithm', '123'));
});

test('b50CacheAtKey 和时间戳键是同一个前缀 + :at', () => {
  assert.equal(b50CacheAtKey('maimai', '123'), `${b50CacheKey('maimai', '123')}:at`);
});

test('所有常量都是非空字符串，且互不相同', () => {
  const keys = [
    B50_CACHE_INDEX_KEY,
    B50_DIFF_KEY,
    PUSH_SEED_KEY,
    QUERY_VALUE_KEY,
    QUERY_KIND_KEY,
    CURRENT_GAME_KEY,
  ];

  for (const key of keys) {
    assert.equal(typeof key, 'string');
    assert.ok(key.trim().length > 0, '键不能是空的');
  }

  assert.equal(new Set(keys).size, keys.length, `这些键里有重复的：${keys.join(', ')}`);
});

test('缓存键不会和别的键撞前缀', () => {
  const cache = b50CacheKey('maimai', '123');
  assert.notEqual(cache, B50_CACHE_INDEX_KEY);
  assert.notEqual(cache, B50_DIFF_KEY);
});

// ══════════════════════════════════════════════════════════════════════
// 页面里不许硬编码
// ══════════════════════════════════════════════════════════════════════

test('页面里不再硬编码共享键（必须从 keys.js 取）', () => {
  const offenders = [];

  for (const file of collectFiles(SRC)) {
    const text = readFileSync(file, 'utf8');

    for (const key of SHARED_KEYS) {
      // 匹配 'b50LastDiff' / "b50LastDiff" / `b50LastDiff`
      const literal = new RegExp(`['"\`]${key}['"\`]`);
      if (literal.test(text)) {
        offenders.push(`${file.replace(SRC, '').replace(/\\/g, '/')} 硬编码了 '${key}'`);
      }
    }
  }

  assert.deepEqual(offenders, [], `这些地方还在硬编码共享键：\n  ${offenders.join('\n  ')}`);
});

test('页面里不再手拼 b50Cache 前缀', () => {
  const offenders = [];

  for (const file of collectFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    // 形如 `b50Cache:${...}` 的模板串 —— 手拼前缀
    if (/b50Cache:\$\{/.test(text)) {
      offenders.push(`${file.replace(SRC, '').replace(/\\/g, '/')} 手拼了 b50Cache 前缀`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `这些地方手拼了缓存键前缀，应该用 keys.js 的 b50CacheKey()：\n  ${offenders.join('\n  ')}`,
  );
});
