/**
 * 从 GitHub 下载 Vela_input_method 组件的全部文件到项目里。
 *
 * 为什么不用 git clone：本机到 github.com:443 连不通，
 * 但 api.github.com 与 raw.githubusercontent.com 可用。
 *
 * 同时记录上游 commit SHA 到 NOTICE，便于日后对齐版本。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// ── 本地补丁 ────────────────────────────────────────────────────────────
//
// 组件里有几处「无保护地调用平台接口」。官方 manifest 文档的权限表里，
// system.device 只列出 getSerial / getDeviceId，getInfo 在部分平台上并不存在；
// 一旦调不到就抛 TypeError，把整个页面的初始化打断——表现为**页面完全空白**。
//
// 补丁必须在每次重新下载后重新打上，所以写在这里而不是手改。
// 每条都要求精确匹配；匹配不到就报错退出——静默失配会让补丁悄悄消失。

const PATCHES = [
  {
    name: 'device.getInfo 存在性检查',
    find: `  adjustScreenWidth(){
    device.getInfo({
      success: (data) => {
        this.screenWidth = data.screenWidth;
      }
    })
  }`,
    replace: `  adjustScreenWidth(){
    // [AstraMai patch] 加防御。
    //
    // 原代码直接调 device.getInfo(...)，没有任何存在性检查。
    // 但官方 manifest 文档的权限表里，system.device 只列出 getSerial / getDeviceId，
    // getInfo 在部分平台上并不存在——于是这里抛 TypeError，
    // 把整个页面的初始化打断，表现为**页面完全空白**（连页面自己的内容都不渲染）。
    //
    // screenWidth 拿不到不影响输入法主体功能，所以拿不到就用默认值。
    if (!device || typeof device.getInfo !== 'function') return;
    device.getInfo({
      success: (data) => {
        this.screenWidth = data.screenWidth;
      }
    })
  }`,
  },
  {
    name: 'vibrator.vibrate 存在性检查',
    find: `  onVibrate() {
    if (this.vibratemode != "") {
      vibrator.vibrate({ mode: this.vibratemode });
    }
  },`,
    replace: `  onVibrate() {
    // [AstraMai patch] 同样加防御：模拟器等环境可能没有振动器，
    // 抛出去会把页面初始化打断。
    if (this.vibratemode != "" && vibrator && typeof vibrator.vibrate === 'function') {
      vibrator.vibrate({ mode: this.vibratemode });
    }
  },`,
  },
];

console.log('\n应用本地补丁');
const componentPath = resolve(DEST_ROOT, 'InputMethod.ux');
let componentSource = readFileSync(componentPath, 'utf8');
const applied = [];

for (const patch of PATCHES) {
  if (componentSource.includes(patch.replace)) {
    console.log(`   = ${patch.name}（已是打过补丁的版本）`);
    applied.push(patch.name);
    continue;
  }
  if (!componentSource.includes(patch.find)) {
    console.error(`   ✗ ${patch.name}：找不到原始代码`);
    console.error('     上游可能改过这段，请人工核对后再更新补丁。');
    process.exit(1);
  }
  componentSource = componentSource.replace(patch.find, patch.replace);
  console.log(`   ✔ ${patch.name}`);
  applied.push(patch.name);
}
writeFileSync(componentPath, componentSource, 'utf8');

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

## 本地改动

**不要手改这个目录里的文件**——升级时会被整体覆盖。
所有改动都由 \`scripts/vendor-input-method.mjs\` 在下载后自动重新打上：

${applied.map((name) => `- ${name}`).join('\n')}

原因：组件里有几处无保护地调用平台接口。官方 manifest 文档的权限表里，
\`system.device\` 只列出 \`getSerial\` / \`getDeviceId\`，\`getInfo\` 在部分平台上不存在。
一旦调不到就抛 \`TypeError\`，把整个页面的初始化打断，症状是**页面完全空白**
（连页面自己的内容都不渲染）。

升级方式：重新运行 \`node scripts/vendor-input-method.mjs\`。

---

## 上游 LICENSE 原文

\`\`\`
${license.trim()}
\`\`\`
`,
  'utf8',
);
console.log('已写入 NOTICE.md');
