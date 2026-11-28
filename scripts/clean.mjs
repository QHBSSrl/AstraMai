/**
 * 清理仓库里的可再生成物。
 *
 * ── 默认只删「便宜」的东西 ────────────────────────────────────────
 *
 * 判断标准不是「能不能重新生成」，而是**重新生成的代价 vs 省下的空间**。
 *
 *     Vela 的 .temp_vela / build   几 MB，重建几秒      → 随便删
 *     站点 dist                     几十 MB，重建几秒    → 随便删
 *     wrangler 状态                 34 MB，下次用到再建  → 随便删
 *     .probe（排查临时文件）          几百 MB，本来就是垃圾 → 随便删
 *
 * ── Flutter 的构建缓存默认**不删** ───────────────────────────────
 *
 * `apps/flutter/build`（8 GB）+ `.dart_tool`（400 MB）是**增量构建缓存**，
 * 删了下次 `flutter build` 要全量重编：几分钟到十几分钟。
 *
 * 用户原话：「Flutter 构建产物删了干嘛，下次构建还要多等一段时间」
 *
 * 对 —— 用 8 GB 换一次全量重编不值。所以默认跳过，要清得显式加 `--deep`。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *
 *     node scripts/clean.mjs           # 默认：只删便宜的
 *     node scripts/clean.mjs --deep    # 连 Flutter 构建缓存一起删
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DEEP = process.argv.includes('--deep');

function sizeOf(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of readdirSync(p)) total += sizeOf(join(p, name));
  return total;
}

/** 默认就删的：体积小、重建快，或者本来就是垃圾。 */
const always = [
  { path: 'apps/vela/.temp_vela', why: 'aiot 临时目录，重建几秒' },
  { path: 'apps/vela-watch/.temp_vela', why: 'aiot 临时目录，重建几秒' },
  { path: 'apps/vela-band/.temp_vela', why: 'aiot 临时目录，重建几秒' },
  { path: 'apps/vela-bandpro/.temp_vela', why: 'aiot 临时目录，重建几秒' },
  { path: 'apps/vela/build', why: 'aiot 中间产物，重建几秒' },
  { path: 'apps/vela-watch/build', why: 'aiot 中间产物，重建几秒' },
  { path: 'apps/vela-band/build', why: 'aiot 中间产物，重建几秒' },
  { path: 'apps/vela-bandpro/build', why: 'aiot 中间产物，重建几秒' },
  { path: 'apps/site/dist', why: '站点产物，重建几秒' },
  { path: 'apps/site-v2/dist', why: '站点产物，重建几秒' },
  { path: '.wrangler', why: 'wrangler 本地状态，用到时重建' },
];

/** 只有 `--deep` 才删的：省空间但代价高。 */
const deepOnly = [
  {
    path: 'apps/flutter/build',
    why: '增量构建缓存 —— 删了下次全量重编（几分钟到十几分钟）',
  },
  {
    path: 'apps/flutter/.dart_tool',
    why: 'Dart 缓存 —— 删了要重新 pub get',
  },
];

const targets = DEEP ? [...always, ...deepOnly] : always;

let freed = 0;

for (const t of targets) {
  const full = join(ROOT, t.path);
  if (!existsSync(full)) continue;
  const size = sizeOf(full);
  try {
    rmSync(full, { recursive: true, force: true });
    freed += size;
    console.log(`  ✔ ${t.path.padEnd(32)} ${(size / 1024 / 1024).toFixed(1).padStart(8)} MB   ${t.why}`);
  } catch (error) {
    console.log(`  ⚠️ ${t.path} 删不掉：${error.code || error.message}`);
  }
}

console.log(`\n  共释放 ${(freed / 1024 / 1024).toFixed(1)} MB`);

if (!DEEP) {
  const buildSize = sizeOf(join(ROOT, 'apps/flutter/build')) + sizeOf(join(ROOT, 'apps/flutter/.dart_tool'));
  if (buildSize > 0) {
    console.log(
      `\n  保留 apps/flutter 的构建缓存（${(buildSize / 1024 / 1024 / 1024).toFixed(1)} GB）——` +
        '\n  删了下次要全量重编，不值得。真要清：node scripts/clean.mjs --deep',
    );
  }
}

console.log('\n  保留：');
console.log('    dist/         收集好的构建产物（npm run collect 维护）');
console.log('    node_modules  依赖');
console.log('    apps/site     旧站源码');
console.log('    apps/site-v2  新站源码');
console.log('    plugins/      网桥插件源码');
console.log('    apps/sync-web apps/watchOS apps/HarmoneyOSWatch  占位目录');
