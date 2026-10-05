/**
 * 一键开发脚本：并行拉起 core 的增量编译、服务端与前端。
 *
 * 不引入 concurrently / npm-run-all 这类依赖——只需要三个子进程和一点前缀输出。
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const COLORS = {
  core: '\u001b[35m',
  server: '\u001b[36m',
  web: '\u001b[32m',
  reset: '\u001b[0m',
};

const targets = [
  { name: 'core', command: 'npm run dev -w @astramai/core' },
  { name: 'server', command: 'npm run dev -w @astramai/server' },
  { name: 'web', command: 'npm run dev -w @astramai/web' },
];

const children = [];
let shuttingDown = false;

function prefixStream(stream, name, write) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      write(`${COLORS[name] ?? ''}[${name}]${COLORS.reset} ${line}\n`);
    }
  });
}

for (const target of targets) {
  const child = spawn(target.command, {
    cwd: root,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  prefixStream(child.stdout, target.name, (text) => process.stdout.write(text));
  prefixStream(child.stderr, target.name, (text) => process.stderr.write(text));

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`\n[dev] ${target.name} 已退出（code ${code}），正在停止其余进程…`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        // 忽略
      }
    }
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('\n[dev] AstraMai 开发环境启动中…');
console.log('[dev] 服务端 http://127.0.0.1:8787  前端 http://127.0.0.1:5173\n');
