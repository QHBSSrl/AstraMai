#!/usr/bin/env node
/**
 * 切换手表快应用的 package。
 *
 * ── 为什么需要这个 ──────────────────────────────────────────────────
 *
 * 小米穿戴的 interconnect **要求快应用的 `package` 和手机 App 的
 * `applicationId` 完全一致**，否则连不上，而且不给有用的错误。
 *
 * 我们分了两个包体：
 *
 *   手表（Watch 系列）  com.nowmes.orhythm
 *   手环 Pro（带网桥）  com.nowmes.orhythm.band
 *
 * 所以打 RPK 之前要先把 manifest 的 package 换对。
 *
 * 用法：
 *   node scripts/vela-package.mjs std      # 手表版
 *   node scripts/vela-package.mjs band     # 手环版
 *   node scripts/vela-package.mjs show     # 看当前是哪个
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '..', 'apps', 'vela', 'src', 'manifest.json');

/** 两个包体对应的 package。 */
const PACKAGES = {
  std: 'com.nowmes.orhythm',
  band: 'com.nowmes.orhythm.band',
};

const mode = (process.argv[2] || 'show').toLowerCase();

const raw = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(raw);
const current = manifest.package;

if (mode === 'show') {
  const which =
    Object.entries(PACKAGES).find(([, pkg]) => pkg === current)?.[0] ?? '未知';
  console.log(`  当前 package: ${current}  (${which})`);
  process.exit(0);
}

if (!PACKAGES[mode]) {
  console.error(`  ❌ 未知模式：${mode}`);
  console.error(`     可选：${Object.keys(PACKAGES).join(' / ')}`);
  process.exit(1);
}

const next = PACKAGES[mode];
if (current === next) {
  console.log(`  已经是 ${next}，没改。`);
  process.exit(0);
}

manifest.package = next;

/*
 * ⚠️ 用 2 空格缩进 + 末尾换行，和原文件保持一致 ——
 * 不然每次切来切去 git diff 都会把整个文件标成改动。
 */
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`  ✅ package: ${current} → ${next}`);
console.log('');
console.log('  别忘了手机端也要打对应 flavor：');
console.log(
  mode === 'band'
    ? '    cd apps/flutter && flutter build apk --flavor band'
    : '    cd apps/flutter && flutter build apk --flavor std',
);
