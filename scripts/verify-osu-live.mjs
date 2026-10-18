/**
 * 用真实凭据打 osu! API，核对我们的映射。
 *
 * ── 为什么要单独写这个 ─────────────────────────────────────────────
 *
 * 单元测试用的是**照文档猜的响应形状**，全绿不代表映射对。
 * 这个脚本打真实接口，把上游的**原始字段名**打出来，
 * 再跑我们的映射，两边对比。
 *
 * 顺序很重要：**先看原始形状，再判断映射**。
 * 之前几次「检查脚本写错、误报代码有问题」都是因为先有假设再看结果。
 */

import { readFileSync } from 'node:fs';

import { OsuSource, mapPlayer, mapScore } from '../apps/server/dist/sources/osu.js';
import { UpstreamLimiter } from '../apps/server/dist/sources/upstream-limiter.js';

// ── 从 .env 读凭据（不打印）────────────────────────────────────────
function loadEnv() {
  const out = {};
  try {
    const text = readFileSync('.env', 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    // 没有 .env 就靠环境变量
  }
  return out;
}

const env = loadEnv();
const clientId = env.OSU_CLIENT_ID || process.env.OSU_CLIENT_ID;
const clientSecret = env.OSU_CLIENT_SECRET || process.env.OSU_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ 缺少 OSU_CLIENT_ID / OSU_CLIENT_SECRET');
  process.exit(1);
}

// ── 1. 换 token ───────────────────────────────────────────────────────
console.log('=== 1. Client Credentials 换 token ===');

const tokenResponse = await fetch('https://osu.ppy.sh/oauth/token', {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'public',
  }).toString(),
});

console.log(`  HTTP ${tokenResponse.status}`);

if (!tokenResponse.ok) {
  const text = await tokenResponse.text();
  console.error('❌ token 失败：', text.slice(0, 300));
  console.error('');
  console.error('   如果是 invalid_client，说明 client_id / secret 不对。');
  process.exit(1);
}

const token = await tokenResponse.json();
console.log(`  ✅ 拿到 token（${token.token_type}，有效期 ${token.expires_in} 秒）`);

// ── 2. 取玩家资料，看原始字段 ─────────────────────────────────────────
const USERNAME = process.argv[2] ?? 'mrekk';
console.log(`\n=== 2. 玩家资料 /users/${USERNAME}/osu ===`);

const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' };

const playerResponse = await fetch(
  `https://osu.ppy.sh/api/v2/users/${encodeURIComponent(USERNAME)}/osu`,
  { headers },
);
console.log(`  HTTP ${playerResponse.status}`);

if (!playerResponse.ok) {
  console.error('❌ 取玩家失败：', (await playerResponse.text()).slice(0, 300));
  process.exit(1);
}

const playerRaw = await playerResponse.json();
console.log('  原始顶层字段：');
console.log(`    ${Object.keys(playerRaw).join(', ')}`);
console.log('  statistics 的键：');
const statsKeys = playerRaw.statistics ? Object.keys(playerRaw.statistics) : [];
console.log(`    ${statsKeys.length > 0 ? statsKeys.join(', ') : '（没有 statistics）'}`);

console.log('\n  我们的 mapPlayer 结果：');
const mapped = mapPlayer(playerRaw, 'osu');
console.log(`    ${JSON.stringify(mapped, null, 2).replace(/\n/g, '\n    ')}`);

// ── 3. 取最好成绩，看原始字段 ─────────────────────────────────────────
console.log(`\n=== 3. 最好成绩 /users/${playerRaw.id}/scores/best?mode=osu&limit=3 ===`);

const scoresResponse = await fetch(`https://osu.ppy.sh/api/v2/users/${playerRaw.id}/scores/best?mode=osu&limit=3`, { headers });
console.log(`  HTTP ${scoresResponse.status}`);

if (!scoresResponse.ok) {
  console.error('❌ 取成绩失败：', (await scoresResponse.text()).slice(0, 300));
  process.exit(1);
}

const scoresRaw = await scoresResponse.json();
console.log(`  返回 ${Array.isArray(scoresRaw) ? scoresRaw.length : '(不是数组)'} 条`);

if (Array.isArray(scoresRaw) && scoresRaw.length > 0) {
  const first = scoresRaw[0];
  console.log('  第一条的顶层字段：');
  console.log(`    ${Object.keys(first).join(', ')}`);

  console.log('  beatmap 的键：');
  console.log(`    ${first.beatmap ? Object.keys(first.beatmap).join(', ') : '（没有 beatmap）'}`);
  console.log('  beatmapset 的键：');
  console.log(`    ${first.beatmapset ? Object.keys(first.beatmapset).join(', ') : '（没有 beatmapset）'}`);
  console.log('  weight：');
  console.log(`    ${first.weight ? JSON.stringify(first.weight) : '（没有 weight）'}`);

  console.log('\n  我们的 mapScore 结果：');
  for (const item of scoresRaw) {
    const mappedScore = mapScore(item);
    console.log(`    ${JSON.stringify(mappedScore)}`);
  }
}

// ── 4. 用真正的 OsuSource 跑一遍 ──────────────────────────────────────
console.log(`\n=== 4. 走 OsuSource 完整流程 ===`);

const limiter = new UpstreamLimiter(50);
const source = new OsuSource({
  clientId,
  clientSecret,
  limiter,
  bestLimit: 3,
});

try {
  const bests = await source.getOsuBests({ username: USERNAME });
  console.log(`  玩家：${bests.player.username}（#${bests.player.globalRank}）`);
  console.log(`  pp：${bests.totalPp}`);
  console.log(`  成绩 ${bests.scores.length} 条：`);
  for (const score of bests.scores) {
    console.log(
      `    ${score.pp.toFixed(2).padStart(7)}pp  ${score.title} [${score.version}]  ` +
        `${(score.accuracy * 100).toFixed(2)}%  权重 ${score.weightPercent}%`,
    );
  }
  console.log(`  本次消耗上游配额：${limiter.status().usedThisMinute} 次`);
} catch (error) {
  console.error(`  ❌ ${error.message}`);
  console.error(`     friendly: ${error.friendlyMessage}`);
  process.exit(1);
}

console.log('\n=== 5. 一致性检查 ===');

let problems = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `   ${extra}` : ''}`);
  if (!ok) problems += 1;
};

check('玩家名非空', mapped.username.length > 0, mapped.username);
check('pp 是有限数', Number.isFinite(mapped.pp), String(mapped.pp));
check('准确率在 0–1', mapped.accuracy >= 0 && mapped.accuracy <= 1, String(mapped.accuracy));
check('全球排名是数字或 null', mapped.globalRank === null || Number.isFinite(mapped.globalRank));

if (Array.isArray(scoresRaw) && scoresRaw.length > 0) {
  const firstScore = mapScore(scoresRaw[0]);
  check('成绩 pp 有限', Number.isFinite(firstScore.pp), String(firstScore.pp));
  check('成绩标题拼出了艺术家', firstScore.title.includes(' - '), firstScore.title);
  check('难度名非空', firstScore.version.length > 0, firstScore.version);
  check('星数 > 0', firstScore.starRating > 0, String(firstScore.starRating));
  check('有曲绘', firstScore.coverUrl.length > 0, firstScore.coverUrl.slice(0, 50));
}

process.exit(problems === 0 ? 0 : 1);
