/**
 * 一条命令完成：构建 → 部署到模拟器 → 启动 → 读回应用日志。
 *
 * 为什么要这个：模拟器上的应用日志只出现在 NuttX 的 dmesg 里，
 * 而且缓冲区很小，手工 adb 往往只能看到错误的尾巴。
 *
 * ⚠️ 四个坑，这个脚本专门处理了：
 *
 *   1. `aiot build` **失败时退出码依然是 0**。必须检查输出里的 ❌ / "build error"，
 *      否则会一路推着旧包，还以为是新代码没生效。
 *
 *   2. `unzip -o` 不会删除「新包里没有、设备上却还在」的文件，
 *      所以部署前先清掉目标目录，避免跑到上一次的残留。
 *
 *   3. **设备的 unzip 不会自动创建目标目录。**（圆屏上撞到的）
 *      `unzip -o x.rpk -d <dest>` 在 dest 不存在时报
 *      「Error changing into ..., aborting」。
 *      而流程要先删旧目录，于是必然踩中 → 解包前必须 `mkdir -p`。
 *
 *   4. **nsh 的 shell 失败也返回 exit 0。** 这是最坑的一条：
 *      上面那个解包错误发生时 exit code 是 0，脚本一路绿灯跑完、
 *      报告"完成"，应用却根本没装上——表现为「启动后还是表盘」。
 *      所以这里**检查输出文本**，并在解包后**回读目录确认文件真的在**。
 *
 * 用法：
 *   node scripts/vela-deploy.mjs             构建 + 部署 + 启动 + 读日志
 *   node scripts/vela-deploy.mjs --no-build  跳过构建（RPK 已是最新时省时间）
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ADB =
  process.env.VELA_ADB ??
  `${process.env.USERPROFILE}\\.vela\\sdk\\tools\\adb\\win\\adb.exe`;
const DEVICE = process.env.VELA_DEVICE ?? 'emulator-5554';
const PKG = 'com.astranexus.astramai';
// ⚠️ 只回一层。这里原来写的是 '../../apps/vela'，
// 多了一层 `..` 会解析到仓库**外面**（D:\Works\AstraNexus\Code\apps\vela），
// 于是这个脚本从写下来就是坏的——一直没人发现，
// 因为实际用的是 .probe/verify/deploy-and-log.mjs。
const projectRoot = resolve(import.meta.dirname, '../apps/vela');

/**
 * 找 RPK。
 *
 * **不写死版本号**——原来写的是 `...debug.0.1.0.rpk`，升到 0.1.1 就失配了，
 * 而这类失配的报错是「找不到 RPK」，很容易被当成构建失败去查错方向。
 *
 * 优先用 `dist/` 里 mtime 最新的那个；没有就报清楚缺什么。
 */
function findRpk() {
  const distDir = resolve(projectRoot, 'dist');
  if (!existsSync(distDir)) return null;
  const candidates = readdirSync(distDir)
    .filter((f) => f.startsWith(`${PKG}.`) && f.endsWith('.rpk'))
    .map((f) => resolve(distDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

let rpk = findRpk();
const REMOTE_DIR = `/data/quickapp/app/${PKG}`;
/**
 * RPK 推到 `/data/quickapp/tmp/`，不要放在 `/data/quickapp/app/` 下。
 *
 * ⚠️ 放在 `app/` 里时（即使是目标目录的同级），解压会**中途截断**：
 * 9 个页面只解出 6 个，而且 unzip 返回 0、不报错。
 * 症状是应用起来白屏或黑屏，dmesg 里一句日志都没有。
 *
 * 挪到 `tmp/` 之后实测能完整解出全部页面。
 *
 * （写这段注释时踩过一个坑：`**` 紧跟 `/` 会组成 `*` `/`，
 *   把块注释提前闭合，Node 报 `ReferenceError` 指向注释中间。
 *   所以这里不再用 markdown 的加粗路径写法。）
 */
const REMOTE_RPK = `/data/quickapp/tmp/${PKG}.rpk`;

const NO_BUILD = process.argv.includes('--no-build');

function adb(args) {
  return execFileSync(ADB, ['-s', DEVICE, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/**
 * 执行设备命令并**检查输出**。
 * 不能只看退出码——nsh 失败也返回 0（见文件头第 4 条）。
 */
function shellOrDie(label, command, mustNotMatch) {
  let text = '';
  try {
    text = adb(['shell', command]).trim();
  } catch (error) {
    console.error(`   ❌ ${label} 抛出异常：${String(error.message).split('\n')[0]}`);
    process.exit(1);
  }
  if (mustNotMatch && mustNotMatch.test(text)) {
    console.error(`   ❌ ${label} 输出里有错误：${text.slice(0, 180)}`);
    process.exit(1);
  }
  console.log(`   完成 ${label}`);
  return text;
}

if (!NO_BUILD) {
  console.log('① 构建…');
  const before = existsSync(rpk) ? statSync(rpk).mtimeMs : 0;

  const build = spawnSync(resolve(projectRoot, 'node_modules/.bin/aiot.cmd'), ['build'], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: true,
  });

  const output = `${build.stdout ?? ''}\n${build.stderr ?? ''}`;
  if (/❌|build error|webpack error/i.test(output)) {
    console.error('构建失败：\n');
    const lines = output.split('\n').filter((line) => /❌|error|Unexpected|not valid/i.test(line));
    for (const line of lines.slice(0, 25)) console.error('  ' + line.trim());
    process.exit(1);
  }

  const after = existsSync(rpk) ? statSync(rpk).mtimeMs : 0;
  if (after === before) {
    console.error('构建报告成功，但 RPK 没有更新——检查是否有别的报错。');
    console.error(output.split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  console.log(`   完成（RPK ${(statSync(rpk).size / 1024).toFixed(1)} KB）`);
} else {
  console.log('① 跳过构建');
}

if (!existsSync(rpk)) {
  console.error(`找不到 RPK：${rpk}`);
  process.exit(1);
}

console.log('② 清理设备上的旧文件…');
shellOrDie('rm -rf', `rm -rf ${REMOTE_DIR}`);

console.log('③ 推送…');
adb(['push', rpk, REMOTE_RPK]);
console.log('   完成');

console.log('④ 解包…');
// ⚠️ 顺序是关键：unzip 不会自己建目录（文件头第 3 条）
shellOrDie('mkdir -p', `mkdir -p ${REMOTE_DIR}`, /failed|not found/i);
const unzipOutput = shellOrDie(
  'unzip',
  `unzip -o ${REMOTE_RPK} -d ${REMOTE_DIR}`,
  /Error|aborting|failed/i,
);

/*
 * 解压输出是**诊断的唯一线索**。
 *
 * NuttX 的 unzip 在人眼看不到的地方可能提前停下（返回 0、不报错），
 * 所以把「解出多少个文件」打出来——出问题时一眼能看出是「没解完」。
 */
{
  const extracted = (unzipOutput.match(/extracting:/g) ?? []).length;
  console.log(`   解出 ${extracted} 个文件`);
}

// 回读确认——不信任前面任何一步的"成功"
const listing = adb(['shell', `ls ${REMOTE_DIR}`]).trim();
const files = listing.split('\n').map((s) => s.trim()).filter(Boolean);
if (files.length === 0) {
  console.error('   ❌ 解包后目录是空的——部署没成功');
  process.exit(1);
}
if (!files.some((f) => f.includes('manifest'))) {
  console.error(`   ❌ 目录里没有 manifest.json，包不完整（${files.length} 个条目）`);
  process.exit(1);
}

/*
 * ⚠️ **只数顶层条目是不够的。**
 *
 * `pages/` 这个目录只要存在就算过，但里面可能只解压了几个页面。
 * 之前就是这么放过去的：设备上 pages/ 只有 5 个目录（应该 9 个），
 * 结果应用起来白屏、且没有任何日志。
 *
 * 所以这里**逐个数页面**，和 manifest 里声明的路由数量对齐。
 */
const expectedPages = (() => {
  try {
    const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'src/manifest.json'), 'utf8'));
    return Object.keys(manifest.router.pages);
  } catch {
    return [];
  }
})();

/*
 * ── 用什么当证据 ────────────────────────────────────────────────────
 *
 * **不能用 `ls pages` 的结果。** 实测同一个包连续部署三次：
 * unzip 每次都解出 103 个文件（完全一致），但 `ls pages` 报 9 / 9 / 5 —— 
 * **NuttX 的目录列举在刚写完时不稳**，会漏掉已经存在的条目。
 *
 * 所以改用 **unzip 自己的输出**：它逐条列了 `extracting: <path>`，
 * 从里面算出哪些页面真的落盘了。这是工具自己报的，最可信。
 */
const extractedPages = new Set();
for (const line of unzipOutput.split('\n')) {
  const match = line.match(/extracting:\s*pages\/([^/]+)\//);
  if (match) extractedPages.add(match[1]);
}

if (expectedPages.length > 0) {
  const missing = expectedPages
    .map((route) => route.split('/').pop())
    .filter((name) => !extractedPages.has(name));

  if (missing.length > 0) {
    console.error(`   ❌ 这些页面没解出来：${missing.join(', ')}`);
    console.error('      应用起来会白屏或黑屏，dmesg 里一句日志都没有。');
    console.error('      重新跑一次部署通常就好。');
    process.exit(1);
  }
}

console.log(
  `   确认：${files.length} 个顶层条目，${extractedPages.size} 个页面，manifest.json 在`,
);

console.log('⑤ 启动…');
spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Start-Process -FilePath '${ADB}' -ArgumentList '-s','${DEVICE}','shell','cd /data/quickapp; vapp app/${PKG}' -NoNewWindow`,
  ],
  { stdio: 'ignore' },
);

await new Promise((r) => setTimeout(r, 9000));

console.log('⑥ 读取日志…\n');
const dmesg = adb(['shell', 'dmesg']);
const lines = dmesg.split('\n').filter((line) => /AIOTJS|AstraMai|astramai/.test(line));

console.log(`（dmesg 里相关行 ${lines.length} 条）\n`);
for (const line of lines) {
  console.log(line.replace(/^\[\d+\/\d+ \d+:\d+:\d+\] \[\d+\] \[ap\] /, ''));
}
