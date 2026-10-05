/**
 * 从 GitHub 下载 Vela_input_method 组件的全部文件到项目里。
 *
 * 为什么不用 git clone：本机到 github.com:443 连不通，
 * 但 api.github.com 与 raw.githubusercontent.com 可用。
 *
 * 同时记录上游 commit SHA 到 NOTICE，便于日后对齐版本。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPO = 'NEORUAA/Vela_input_method';
const BRANCH = 'main';
const PREFIX = 'components/InputMethod/';
// scripts/ 的上一级才是仓库根
const DEST_ROOT = resolve(import.meta.dirname, '../apps/vela/src/components/InputMethod');

const headers = { 'user-agent': 'astramai-dev' };

const treeRes = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`, {
  headers,
});
if (!treeRes.ok) {
  console.error('拉取目录失败：', treeRes.status);
  process.exit(1);
}
const tree = await treeRes.json();

const refRes = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { headers });
const ref = refRes.ok ? await refRes.json() : null;
const commitSha = ref ? ref.sha : 'unknown';
const commitDate = ref && ref.commit ? ref.commit.author.date : 'unknown';

const targets = tree.tree.filter((node) => node.type === 'blob' && node.path.startsWith(PREFIX));
console.log(`待下载 ${targets.length} 个文件（上游 ${commitSha.slice(0, 7)}，${commitDate}）\n`);

let done = 0;
let bytes = 0;

for (const node of targets) {
  const relative = node.path.slice(PREFIX.length);
  const outPath = resolve(DEST_ROOT, relative);
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${node.path}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`  ✗ ${relative} HTTP ${res.status}`);
    continue;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buffer);
  done += 1;
  bytes += buffer.length;
  if (done % 20 === 0) console.log(`  已下载 ${done}/${targets.length}…`);
}

console.log(`\n完成：${done}/${targets.length} 个文件，${(bytes / 1024).toFixed(1)} KB`);

// MIT 要求保留版权声明
const licenseRes = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/LICENSE`, { headers });
const license = licenseRes.ok ? await licenseRes.text() : '（未取到上游 LICENSE，请自行核对）';

writeFileSync(
  resolve(DEST_ROOT, 'NOTICE.md'),
  `# 第三方组件：Vela_input_method

本目录下的代码来自 [${REPO}](https://github.com/${REPO})，遵循 MIT 许可。

- 上游分支：\`${BRANCH}\`
- 上游 commit：\`${commitSha}\`
- 提交时间：${commitDate}
- 抓取时间：${new Date().toISOString()}

**本地改动**：无（保持与上游一致，便于日后整体更新）。
升级方式：重新运行 \`scripts/vendor-input-method.mjs\`。

---

## 上游 LICENSE 原文

\`\`\`
${license.trim()}
\`\`\`
`,
  'utf8',
);
console.log('已写入 NOTICE.md');
