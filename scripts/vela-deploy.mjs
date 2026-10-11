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
import { existsSync, statSync } from 'node:fs';
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
const rpk = resolve(projectRoot, `dist/${PKG}.debug.0.1.0.rpk`);
const REMOTE_DIR = `/data/quickapp/app/${PKG}`;
const REMOTE_RPK = `/data/quickapp/app/${PKG}.rpk`;

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
shellOrDie('unzip', `unzip -o ${REMOTE_RPK} -d ${REMOTE_DIR}`, /Error|aborting|failed/i);

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
console.log(`   确认：${files.length} 个条目，manifest.json 在`);

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
