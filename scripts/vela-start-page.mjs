/**
 * 临时把某个页面设成启动页，方便反复调试某一屏。
 *
 * ── 为什么需要这个 ──────────────────────────────────────────────────
 *
 * `aiot start --start-page 'pages/Welcome'` 是对的用法，
 * 但它会**自己起一个模拟器**：如果已经有一个在跑（比如用
 * `boot-emulator.mjs` 起的），它会报
 * 「this emulator is unavailable, please create a new emulator」。
 *
 * 而 Vela 的启动页是 manifest 里的 **`router.entry`**，改它 + 重新部署
 * 就能让任何页面成为入口，不需要 `aiot start`。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *
 *   node scripts/vela-start-page.mjs pages/Welcome
 *       → 改成从 Welcome 启动，然后提示你自己 build + deploy
 *
 *   node scripts/vela-start-page.mjs pages/Welcome --build
 *       → 顺便构建（不部署）
 *
 *   node scripts/vela-start-page.mjs --revert
 *       → 恢复原来的入口
 *
 * ⚠️ **改完记得 revert**，不然发出去的包里入口页就是别的页面了。
 *    脚本会在开始前备份到 `.vela-start-page-backup.json`。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VELA = resolve(HERE, '../apps/vela');
const MANIFEST = resolve(VELA, 'src/manifest.json');
const BACKUP = resolve(HERE, '../.vela-start-page-backup.json');

const args = process.argv.slice(2);
const revert = args.includes('--revert');
const build = args.includes('--build');
const target = args.find((arg) => !arg.startsWith('--'));

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

if (revert) {
  if (!existsSync(BACKUP)) {
    console.error('❌ 没有备份，说明当前没有改过入口页。');
    process.exit(1);
  }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  manifest.router.entry = backup.entry;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`  ✅ 入口页已还原：${manifest.router.entry}`);
  console.log('     记得重新 build + deploy 才会生效。');
  process.exit(0);
}

if (!target) {
  console.error('用法：');
  console.error("  node scripts/vela-start-page.mjs pages/Welcome");
  console.error('  node scripts/vela-start-page.mjs pages/Welcome --build');
  console.error('  node scripts/vela-start-page.mjs --revert');
  console.error('');
  console.error(`当前入口：${manifest.router.entry}`);
  console.error(`可用页面：${Object.keys(manifest.router.pages).join(', ')}`);
  process.exit(1);
}

if (!manifest.router.pages[target]) {
  console.error(`❌ 没有这个页面：${target}`);
  console.error(`   可用：${Object.keys(manifest.router.pages).join(', ')}`);
  process.exit(1);
}

// 第一次改的时候备份原始入口
if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify({ entry: manifest.router.entry }, null, 2), 'utf8');
  console.log(`  📌 已备份原入口：${manifest.router.entry}`);
}

const previous = manifest.router.entry;
manifest.router.entry = target;
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`  ✅ 入口页：${previous} → ${target}`);

if (build) {
  console.log('  构建中…');
  try {
    execSync('npm run build', { cwd: VELA, stdio: 'inherit' });
    console.log('  ✅ 构建完成');
  } catch {
    console.error('  ❌ 构建失败');
    process.exit(1);
  }
} else {
  console.log('');
  console.log('  下一步：');
  console.log('    cd apps/vela && npm run build');
  console.log('    node scripts/vela-deploy.mjs --no-build');
  console.log('');
  console.log('  调试完记得还原：');
  console.log('    node scripts/vela-start-page.mjs --revert');
}
