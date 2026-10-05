/**
 * 冒烟测试：对着已启动的服务端跑一遍关键链路。
 *
 * 用法：
 *   node scripts/smoke.mjs [baseUrl]
 *
 * 校验重点（Mock 模式下必须全部成立）：
 *   1. /api/health 可用
 *   2. /api/maimai/b50/... 返回结构完整的视图模型
 *   3. 公式自检 100% 通过 —— 即本地 Rating 公式与接口返回的 dx_rating 完全吻合
 *   4. 官方总分 == 本地公式合计
 *   5. 前端静态资源可访问
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');

let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 保留 null
  }
  return { status: res.status, json, text };
}

console.log(`\n冒烟测试目标：${base}\n`);

// ── 1. health ───────────────────────────────────────────────────────────
console.log('[1] /api/health');
const health = await getJson('/api/health');
check('HTTP 200', health.status === 200, `实际 ${health.status}`);
check('ok:true', health.json?.ok === true);
check('返回 mode', typeof health.json?.data?.mode === 'string', `mode=${health.json?.data?.mode}`);

// ── 2. B50（Mock）─────────────────────────────────────────────────────
const friendCode = '888888888888888';
console.log(`\n[2] /api/maimai/b50/${friendCode}?mock=1`);
const b50 = await getJson(`/api/maimai/b50/${friendCode}?mock=1`);
check('HTTP 200', b50.status === 200, `实际 ${b50.status}`);
if (!b50.json?.ok) {
  console.log('  响应：', b50.text.slice(0, 500));
} else {
  const view = b50.json.data;
  check('mode=mock', b50.json.mode === 'mock', `实际 ${b50.json.mode}`);
  check('player.name 存在', typeof view.player?.name === 'string');
  check('standard 有 35 条', view.standard?.length === 35, `实际 ${view.standard?.length}`);
  check('dx 有 15 条', view.dx?.length === 15, `实际 ${view.dx?.length}`);

  const entries = [...view.standard, ...view.dx];
  check('每条都有定数', entries.every((e) => e.levelValue !== null), 
    `${entries.filter((e) => e.levelValue === null).length} 条缺定数`);
  check('每条都有曲绘 URL', entries.every((e) => typeof e.jacketUrl === 'string' && e.jacketUrl.startsWith('https://')));
  check('每条都有物量', entries.every((e) => e.notes && e.notes.total > 0));
  check('每条都有理论满分', entries.every((e) => typeof e.maxRating === 'number' && e.maxRating > 0));

  const sc = view.selfCheck;
  console.log(
    `      自检：参与 ${sc.checked}，一致 ${sc.matched}，不一致 ${sc.mismatched}，缺 dx_rating ${sc.missingApiRating}`,
  );
  check('自检参与数 == 50', sc.checked === 50, `实际 ${sc.checked}`);
  check('公式自检全部一致', sc.mismatched === 0, `不一致 ${sc.mismatched} 条`);
  check('落雪 dx_rating 判定为含 AP 加分', sc.includesApBonus === true, `实际 ${sc.includesApBonus}`);

  check(
    '官方总分 == 本地公式合计',
    view.stats.total === view.stats.computedTotal,
    `官方 ${view.stats.total} vs 本地 ${view.stats.computedTotal}`,
  );
  check(
    '总分 == B35 + B15',
    view.stats.total === view.stats.standardTotal + view.stats.dxTotal,
    `${view.stats.standardTotal} + ${view.stats.dxTotal}`,
  );
  check(
    'B35 小计本地公式与官方一致',
    view.stats.computedStandardDelta === 0,
    `本地 ${view.stats.computedStandardTotal} vs 官方 ${view.stats.standardTotal}`,
  );
  check(
    'B15 小计本地公式与官方一致',
    view.stats.computedDxDelta === 0,
    `本地 ${view.stats.computedDxTotal} vs 官方 ${view.stats.dxTotal}`,
  );
  check(
    'B35 / B15 条数分别为 35 / 15',
    view.stats.standardCount === 35 && view.stats.dxCount === 15,
    `actual ${view.stats.standardCount} / ${view.stats.dxCount}`,
  );
  check('理论值总分 > 当前总分', view.stats.theoreticalMaxTotal > view.stats.total);
  check('生成时间存在', typeof view.generatedAt === 'string');
}

// ── 3. 同一输入必须可复现 ───────────────────────────────────────────────
console.log('\n[3] Mock 可复现性');
const again = await getJson(`/api/maimai/b50/${friendCode}?mock=1`);
check(
  '两次查询的评分完全一致',
  JSON.stringify(again.json?.data?.standard?.map((e) => e.rating)) ===
    JSON.stringify(b50.json?.data?.standard?.map((e) => e.rating)),
);

// ── 4. 参数校验 ─────────────────────────────────────────────────────────
console.log('\n[4] 参数校验');
const bad = await getJson('/api/maimai/b50/not-a-number');
check('非法好友码返回 400', bad.status === 400, `实际 ${bad.status}`);
check('错误体带友好文案', typeof bad.json?.error?.friendlyMessage === 'string');

// ── 5. 曲库与搜索 ───────────────────────────────────────────────────────
console.log('\n[5] 曲库与搜索');
const songs = await getJson('/api/maimai/songs');
check('曲库 HTTP 200', songs.status === 200);
check('曲库非空', (songs.json?.data?.songs?.length ?? 0) > 0, `${songs.json?.data?.songs?.length} 首`);
check('曲库带别名表', songs.json?.data?.aliases !== undefined);

const search = await getJson('/api/maimai/search?q=a&limit=5');
check('搜索 HTTP 200', search.status === 200);
check('搜索有结果', (search.json?.data?.results?.length ?? 0) > 0, `${search.json?.data?.results?.length} 条`);

// ── 6. 静态前端 ─────────────────────────────────────────────────────────
console.log('\n[6] 前端静态资源');
const index = await fetch(`${base}/`);
const html = await index.text();
check('首页 HTTP 200', index.status === 200, `实际 ${index.status}`);
check('首页是 HTML', html.includes('<div id="root">') || html.includes('id="root"'));
check('首页引用了构建产物', /assets\/index-.*\.js/.test(html), '没找到 hashed js');
check('SPA 回退可用', (await fetch(`${base}/some/deep/route`)).status === 200);

console.log(`\n${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`}\n`);
process.exit(failures === 0 ? 0 : 1);
