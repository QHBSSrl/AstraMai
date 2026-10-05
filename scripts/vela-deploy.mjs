/**
 * 一条命令完成：构建 → 部署到模拟器 → 启动 → 读回应用日志。
 *
 * 为什么要这个：模拟器上的应用日志只出现在 NuttX 的 dmesg 里，
 * 而且缓冲区很小，手工 adb 往往只能看到错误的尾巴。
 *
 * ⚠️ 两个坑，这个脚本专门处理了：
 *   1. `aiot build` **失败时退出码依然是 0**。必须检查输出里的 ❌ / "build error"，
 *      否则会一路推着旧包，还以为是新代码没生效。
 *   2. `unzip -o` 不会删除「新包里没有、设备上却还在」的文件，
 *      所以部署前先清掉目标目录，避免跑到上一次的残留。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ADB =
  process.env.VELA_ADB ??
  `${process.env.USERPROFILE}\\.vela\\sdk\\tools\\adb\\win\\adb.exe`;
const DEVICE = process.env.VELA_DEVICE ?? 'emulator-5554';
const PKG = 'com.astranexus.astramai';
const projectRoot = resolve(import.meta.dirname, '../../apps/vela');
const rpk = resolve(projectRoot, `dist/${PKG}.debug.0.1.0.rpk`);

function adb(args) {
  return execFileSync(ADB, ['-s', DEVICE, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

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

console.log('② 清理设备上的旧文件…');
try {
  adb(['shell', `rm -rf /data/quickapp/app/${PKG}`]);
} catch {
  // 目录不存在也无所谓
}

console.log('③ 推送…');
adb(['push', rpk, `/data/quickapp/app/${PKG}.rpk`]);

console.log('④ 解包…');
adb(['shell', `unzip -o /data/quickapp/app/${PKG}.rpk -d /data/quickapp/app/${PKG}`]);

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
