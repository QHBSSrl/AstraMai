/**
 * 改版本号。
 *
 * ── 为什么要有脚本 ──────────────────────────────────────────────────
 *
 * 规则是「发出去的用干净号，开发中的带 debug 后缀」，而 `versionCode`
 * 必须严格递增。这两件事手改很容易错：
 *
 *   · 只改了 versionName 忘了 versionCode → 装不上（系统认为不是升级）
 *   · versionCode 改小了 → 同样装不上
 *   · 发布版的 code 比 debug 还小 → 装过 debug 的设备升不回正式版
 *
 * 所以让脚本算：`minor * 10000 + patch * 100 + 小版本`，
 * debug 用 01~98，发布用 99 —— 发布版永远大于同 patch 的所有 debug。
 *
 * 用法：
 *   node scripts/vela-version.mjs show
 *   node scripts/vela-version.mjs debug 1         → 0.1.3debug1 / 10301
 *   node scripts/vela-version.mjs release 0.1.3   → 0.1.3 / 10399
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST = resolve(process.cwd(), 'apps/vela/src/manifest.json');

/** `major.minor.patch` → `{ major, minor, patch }`。 */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) {
    throw new Error(`版本号要写成 X.Y.Z（比如 0.1.3），收到：${text}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * 算 versionCode。
 *
 * 高位放 minor/patch，低两位留给 debug 序号。
 * 不用 major：这个项目的 major 在可预见的将来都是 0。
 */
function codeFor({ minor, patch }, slot) {
  return minor * 10000 + patch * 100 + slot;
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

function writeManifest(manifest, versionName, versionCode) {
  manifest.versionName = versionName;
  manifest.versionCode = versionCode;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * 算出「这次开发该用哪个基础版本号」。
 *
 *   · 当前是 `X.Y.ZdebugN` → 继续开发同一个 `X.Y.Z`
 *   · 当前是 `X.Y.Z`（**已发布**）→ 直接进 `X.Y.(Z+1)`
 *
 * 第二条很重要：发出去的版本号用完就锁死，不能再用它开发
 * （否则装过正式版 `0.1.2` 的设备，拿到 `0.1.2debug1` 会以为
 * 版本号没变，甚至装不上）。
 */
function currentBase(versionName) {
  const text = String(versionName);
  const isDebug = /debug\d+$/i.test(text);
  const base = parseVersion(text.replace(/debug\d+$/i, ''));

  if (isDebug) return base;
  return { ...base, patch: base.patch + 1 };
}

const [, , command, arg] = process.argv;

try {
  const manifest = readManifest();

  if (command === 'show' || command === undefined) {
    console.log(`  versionName: ${manifest.versionName}`);
    console.log(`  versionCode: ${manifest.versionCode}`);
    process.exit(0);
  }

  if (command === 'debug') {
    const slot = Number(arg);
    if (!Number.isInteger(slot) || slot < 1 || slot > 98) {
      throw new Error('debug 序号要是 1~98 的整数');
    }

    const base = currentBase(manifest.versionName);
    const versionName = `${base.major}.${base.minor}.${base.patch}debug${slot}`;
    const versionCode = codeFor(base, slot);

    writeManifest(manifest, versionName, versionCode);
    console.log(`  ✅ ${versionName}  /  ${versionCode}`);
    process.exit(0);
  }

  if (command === 'release') {
    const base = parseVersion(arg ?? '');
    const versionName = `${base.major}.${base.minor}.${base.patch}`;
    const versionCode = codeFor(base, 99);

    writeManifest(manifest, versionName, versionCode);
    console.log(`  ✅ ${versionName}  /  ${versionCode}`);
    process.exit(0);
  }

  throw new Error(`不认识的命令：${command}（可用：show / debug / release）`);
} catch (error) {
  console.error(`  ❌ ${error.message}`);
  process.exit(1);
}
