/** 清理构建产物（dist 与 tsbuildinfo）。 */

import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspaceDirs = [
  join(root, 'packages'),
  join(root, 'apps'),
];

const removed = [];

for (const parent of workspaceDirs) {
  if (!existsSync(parent)) continue;
  for (const name of readdirSync(parent)) {
    const dir = join(parent, name);
    if (!statSync(dir).isDirectory()) continue;
    for (const artifact of ['dist', 'node_modules']) {
      const target = join(dir, artifact);
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        removed.push(target);
      }
    }
  }
}

if (removed.length === 0) console.log('[clean] 没有需要清理的产物。');
else for (const path of removed) console.log(`[clean] 已删除 ${path}`);
