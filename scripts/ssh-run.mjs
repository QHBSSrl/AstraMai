/**
 * 在目标服务器上跑一段 shell 脚本（从本地文件读，走 stdin）。
 *
 * 为什么需要它：用 PowerShell 的 `Get-Content | ssh "bash -s"` 很容易出问题——
 *   - 文件是 CRLF 时，远端 bash 会在每行结尾看到 `\r`，
 *     报 `$'\r': command not found`，而且**报错位置会误导**（看起来像别的命令失败）；
 *   - 中文经过 PowerShell → ssh 会被重新编码成乱码，导致语法错误。
 * 这个脚本用 Node 直接读文件并规范成 LF，两个问题一起消失。
 *
 * 用法：
 *   node scripts/ssh-run.mjs .probe/remote-verify.sh
 *   node scripts/ssh-run.mjs --print .probe/remote-verify.sh    # 只看脚本内容
 *
 * 环境变量与 deploy-server.mjs 一致（DEPLOY_HOST / PORT / USER / KEY）。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOST = process.env.DEPLOY_HOST ?? '101.132.148.117';
const PORT = process.env.DEPLOY_PORT ?? '52778';
const USER = process.env.DEPLOY_USER ?? 'root';
const KEY =
  process.env.DEPLOY_KEY ?? resolve(process.env.USERPROFILE ?? process.env.HOME, '.ssh/astramai_ed25519');

const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法: node scripts/ssh-run.mjs [--print] <本地脚本.sh>');
  process.exit(1);
}

// 统一成 LF：远端 bash 看到裸 \r 会报一串看起来毫不相关的错
const script = readFileSync(resolve(file), 'utf8').replace(/\r\n/g, '\n');

if (printOnly) {
  process.stdout.write(script);
  process.exit(0);
}

process.stdout.write(`在 ${USER}@${HOST} 上执行 ${file} …\n\n`);

try {
  const out = execFileSync(
    'ssh',
    ['-i', KEY, '-p', PORT, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20', `${USER}@${HOST}`, 'bash -s'],
    { encoding: 'utf8', input: script, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 },
  );
  process.stdout.write(out);
} catch (error) {
  const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  process.stdout.write(text);
  console.error(`\n远端执行失败（退出码 ${error.status}）`);
  process.exit(1);
}
