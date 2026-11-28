#!/usr/bin/env node
/**
 * 把所有构建产物收进一个目录，方便找。
 *
 * ── 为什么需要 ────────────────────────────────────────────────────
 *
 * 现在产物散在五个地方：
 *
 *     apps/vela/dist/                    RW 方形表
 *     apps/vela-watch/dist/              小米 Watch 圆形
 *     apps/vela-band/dist/               手环
 *     apps/vela-bandpro/dist/            手环 Pro
 *     apps/flutter/build/app/outputs/    安卓 APK
 *
 * 而且每个都是 `com.nowmes.orhythm.band.release.0.1.4.rpk` 这种名字 ——
 * 四个包摆在一起根本分不出哪个是哪个版本、什么时候打的。
 *
 * 这个脚本把它们**复制**到仓库根的 `dist/`，按设备分目录，
 * 文件名带上设备、版本、时间戳：
 *
 *     dist/band/ORhythm-band-0.1.4-20261128-1331.rpk
 *     dist/android/ORhythm-android-0.1.4-20261128-2200-arm64-v8a.apk
 *
 * 复制而不是做链接：各项目的 dist 随时会被构建清掉，
 * 链接会变成断的 —— 那反而更难找。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *
 *     node scripts/collect-builds.mjs            # 收 RPK + release APK
 *     node scripts/collect-builds.mjs --all      # 连 debug APK 也收
 *     node scripts/collect-builds.mjs --keep 3   # 每类只留最近 3 份
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist');

const argv = process.argv.slice(2);
const includeDebugApk = argv.includes('--all');
const keepIndex = argv.indexOf('--keep');
const KEEP = keepIndex >= 0 ? Number(argv[keepIndex + 1]) || 5 : 5;

/** 设备目录 → 产物来源。 */
const SOURCES = [
  { dir: 'rw', label: 'RW 方形表', rpk: join(ROOT, 'apps/vela/dist') },
  { dir: 'xiaomi-watch', label: '小米 Watch 圆形', rpk: join(ROOT, 'apps/vela-watch/dist') },
  { dir: 'band', label: '小米手环 跑道型', rpk: join(ROOT, 'apps/vela-band/dist') },
  { dir: 'bandpro', label: '小米手环 Pro 长方形', rpk: join(ROOT, 'apps/vela-bandpro/dist') },
];

const APK_DIR = join(ROOT, 'apps/flutter/build/app/outputs/flutter-apk');

/** 从 `com.nowmes.orhythm.band.release.0.1.4.rpk` 里抠出 0.1.4。 */
function versionOf(file) {
  const m = basename(file).match(/(\d+\.\d+\.\d+(?:debug\d+)?)/);
  return m ? m[1] : 'unknown';
}

/** 2026-11-28 22:13 → 20261128-2213 */
function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}`
  );
}

/** 收集结果，最后写成索引。 */
const collected = [];

function copyInto(sourceFile, deviceDir, newName, label) {
  const targetDir = join(OUT, deviceDir);
  mkdirSync(targetDir, { recursive: true });
  const target = join(targetDir, newName);
  copyFileSync(sourceFile, target);
  const st = statSync(target);
  collected.push({
    device: deviceDir,
    label,
    name: newName,
    size: st.size,
    time: st.mtime,
    path: target,
  });
  console.log(`  ✔ ${deviceDir}/${newName}  ${(st.size / 1024).toFixed(0)} KB`);
}

/* ── 1. RPK ──────────────────────────────────────────────────────── */
for (const src of SOURCES) {
  if (!existsSync(src.rpk)) {
    console.log(`  · ${src.dir} 还没有构建产物（${src.rpk}）`);
    continue;
  }

  // 只收 release，debug/diff 那些是本地调试用的
  const files = readdirSync(src.rpk).filter((f) => f.endsWith('.release') || f.includes('.release.'));
  const rpks = readdirSync(src.rpk).filter((f) => /\.release\.\d+\.\d+\.\d+.*\.rpk$/.test(f));

  for (const file of rpks) {
    const full = join(src.rpk, file);
    const version = versionOf(full);
    const when = stamp(statSync(full).mtime);
    const name = `ORhythm-${src.dir}-${version}-${when}.rpk`;
    copyInto(full, src.dir, name, src.label);
  }
}

/* ── 2. APK ──────────────────────────────────────────────────────── */
/*
 * APK 文件名里没有版本号（`app-arm64-v8a-release.apk`），
 * 所以从 `apps/flutter/pubspec.yaml` 的 `version:` 读 ——
 * 那里是 Flutter 构建时真正用的版本，和 manifest 里的一致。
 */
let flutterVersion = 'unknown';
try {
  const pubspec = readFileSync(join(ROOT, 'apps/flutter/pubspec.yaml'), 'utf8');
  const m = pubspec.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)/m);
  if (m) flutterVersion = m[1];
} catch {
  // 读不到就标 unknown，不影响收集
}

if (existsSync(APK_DIR)) {
  const apks = readdirSync(APK_DIR).filter((f) => {
    if (!f.endsWith('.apk')) return false;
    // 默认只收 release；--all 连 debug 一起
    return includeDebugApk ? true : f.includes('release');
  });

  for (const file of apks) {
    const full = join(APK_DIR, file);
    const version = flutterVersion;
    const when = stamp(statSync(full).mtime);
    // app-arm64-v8a-release.apk → arm64-v8a
    const abi = (file.match(/app-(.+?)-(release|debug)\.apk/) || [])[1] || 'universal';
    const kind = file.includes('debug') ? 'debug' : 'release';
    const name = `ORhythm-android-${version}-${when}-${abi}-${kind}.apk`;
    copyInto(full, 'android', name, '安卓手机');
  }
}

/* ── 3. 清理旧版本，每类只留最近 KEEP 份 ─────────────────────────── */
for (const src of [...SOURCES.map((s) => s.dir), 'android']) {
  const dir = join(OUT, src);
  if (!existsSync(dir)) continue;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.rpk') || f.endsWith('.apk'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const old of files.slice(KEEP)) {
    rmSync(join(dir, old.f), { force: true });
    console.log(`  ✂ 清理旧版本 ${src}/${old.f}`);
  }
}

/* ── 4. 写索引 ───────────────────────────────────────────────────── */
const rows = [];
for (const dir of ['rw', 'xiaomi-watch', 'band', 'bandpro', 'android']) {
  const full = join(OUT, dir);
  if (!existsSync(full)) continue;
  const files = readdirSync(full).filter((f) => f.endsWith('.rpk') || f.endsWith('.apk'));
  if (!files.length) continue;
  rows.push(`\n### ${dir}\n`);
  for (const f of files) {
    const st = statSync(join(full, f));
    const when = new Date(st.mtime).toLocaleString('zh-CN');
    rows.push(`- \`${f}\` — ${(st.size / 1024).toFixed(0)} KB — ${when}`);
  }
}

const index = `# 构建产物

这个目录由 \`scripts/collect-builds.mjs\` 生成，**不要手改**。

重新收集：

\`\`\`bash
node scripts/collect-builds.mjs        # RPK + release APK
node scripts/collect-builds.mjs --all  # 连 debug APK
\`\`\`

每个设备目录只保留最近 ${KEEP} 份，更早的会自动删掉。
${rows.join('\n')}
`;

writeFileSync(join(OUT, 'README.md'), index, 'utf8');

console.log(`\n  共收集 ${collected.length} 个文件 → ${OUT}`);
console.log(`  索引：${join(OUT, 'README.md')}`);
