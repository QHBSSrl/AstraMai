/**
 * 清理仓库里的可再生成物和临时垃圾。
 *
 * 只删**能重新生成**或**确定没用**的东西，不碰源码、配置、占位目录。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function sizeOf(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of readdirSync(p)) {
    total += sizeOf(join(p, name));
  }
  return total;
}

/** 要删的目录，以及为什么安全。 */
const targets = [
  // Flutter 的构建中间物和产物 —— `flutter build` 会重新生成。
  // release APK 已经收进 dist/android 了。
  { path: 'apps/flutter/build', why: 'Flutter 构建产物，可重新生成' },
  { path: 'apps/flutter/.dart_tool', why: 'Dart 缓存，pub get 会重建' },

  // Vela 工具链的临时目录和中间产物
  { path: 'apps/vela/.temp_vela', why: 'aiot 工具链临时目录' },
  { path: 'apps/vela-watch/.temp_vela', why: 'aiot 工具链临时目录' },
  { path: 'apps/vela-band/.temp_vela', why: 'aiot 工具链临时目录' },
  { path: 'apps/vela-bandpro/.temp_vela', why: 'aiot 工具链临时目录' },
  { path: 'apps/vela/build', why: 'aiot 中间产物' },
  { path: 'apps/vela-watch/build', why: 'aiot 中间产物' },
  { path: 'apps/vela-band/build', why: 'aiot 中间产物' },
  { path: 'apps/vela-bandpro/build', why: 'aiot 中间产物' },

  // 站点构建产物
  { path: 'apps/site/dist', why: '站点构建产物' },
  { path: 'apps/site-v2/dist', why: '站点构建产物' },

  // Wrangler 的缓存
  { path: '.wrangler', why: 'wrangler 本地缓存' },

  // 我自己排查问题时留下的东西（截图、下载的模板、临时脚本）
  { path: '.probe', why: '排查过程的临时文件，git 未跟踪' },
];

let freed = 0;

for (const t of targets) {
  const full = join(ROOT, t.path);
  if (!existsSync(full)) continue;
  const size = sizeOf(full);
  try {
    rmSync(full, { recursive: true, force: true });
    freed += size;
    console.log(`  ✔ ${t.path.padEnd(34)} ${(size / 1024 / 1024).toFixed(1).padStart(8)} MB   ${t.why}`);
  } catch (error) {
    console.log(`  ⚠️ ${t.path} 删不掉：${error.code || error.message}`);
  }
}

console.log(`\n  共释放 ${(freed / 1024 / 1024 / 1024).toFixed(2)} GB`);
console.log('\n  保留：');
console.log('    dist/         收集好的构建产物（scripts/collect-builds.mjs 维护）');
console.log('    node_modules  依赖');
console.log('    apps/site     旧站源码');
console.log('    apps/site-v2  新站源码');
console.log('    plugins/      网桥插件源码');
console.log('    apps/sync-web apps/watchOS apps/HarmoneyOSWatch  占位目录');
