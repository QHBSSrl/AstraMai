/**
 * 剥掉「同步到手表」这条功能链。
 *
 * 为什么要删而不是隐藏：
 *
 *   小米手环的 Vela 运行时没有可用的 `@system.crypto`（AES 那套跑不起来），
 *   而整个同步方案是**端到端加密**的 —— 没有 AES 就没法解出手机传过来的
 *   数据。留着界面只会让用户点进去报错。
 *
 *   而且用户明确说了：**藏起来不省内存**。JS 包大小、模块加载、内存占用
 *   都还在，只是看不见而已。所以要把代码真的删掉。
 *
 * 删掉的东西：
 *   · pages/Sync/                    同步页
 *   · common/sync-aes.js             AES 实现
 *   · common/sync-client.js          配对码接口
 *   · common/sync-payload.js         载荷编解码
 *   · common/secret.js               设备密钥（只为同步服务）
 *   · common/global.js 里对应的 import / 导出
 *   · settings.ux 里的「同步到手表」入口和 goSync()
 *
 * 注意：**这个脚本只跑一次**，跑完就可以删掉。留着它是为了说明
 * 「手环版和手表版的差异在哪、为什么」。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');

/** 直接删掉的文件/目录。 */
const removals = [
  path.join(src, 'pages', 'Sync'),
  path.join(src, 'common', 'sync-aes.js'),
  path.join(src, 'common', 'sync-client.js'),
  path.join(src, 'common', 'sync-payload.js'),
  path.join(src, 'common', 'secret.js'),
];

for (const p of removals) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log('  rm ' + path.relative(root, p));
  }
}

/* ── global.js：去掉对应的 import 和导出 ─────────────────────────── */
const globalFile = path.join(src, 'common', 'global.js');
let g = fs.readFileSync(globalFile, 'utf8');
const before = g.length;

g = g
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    if (/^import \* as (secret|syncPayload|syncAes|syncClient) from/.test(t)) return false;
    if (/^(secret|syncPayload|syncAes|syncClient),$/.test(t)) return false;
    return true;
  })
  .join('\n');

fs.writeFileSync(globalFile, g, 'utf8');
console.log(`  global.js 精简 ${before - g.length} 字节`);

/* ── settings.ux：去掉「同步到手表」入口 ─────────────────────────── */
const settingsFile = path.join(src, 'pages', 'Settings', 'settings.ux');
let s = fs.readFileSync(settingsFile, 'utf8');

// 整块：注释 + row
s = s.replace(
  /[ \t]*<!--\r?\n[ \t]*同步到手表：[\s\S]*?-->\r?\n[ \t]*<div class="row" @click="goSync">[\s\S]*?<\/div>\r?\n/,
  '',
);

// goSync 方法（含它的注释块）
s = s.replace(
  /[ \t]*\/\*\*\r?\n[ \t]*\* 去同步页。[\s\S]*?\*\/\r?\n[ \t]*goSync\(\) \{\r?\n[\s\S]*?\},\r?\n\r?\n/,
  '',
);

fs.writeFileSync(settingsFile, s, 'utf8');

const stillHasGoSync = /goSync/.test(s);
console.log(`  settings.ux 同步入口已移除（goSync 残留：${stillHasGoSync ? '有 ⚠️' : '无'}）`);

/* ── 自检：还有没有别的地方引用同步模块 ──────────────────────────── */
const remaining = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(js|ux)$/.test(name)) {
      const c = fs.readFileSync(full, 'utf8');
      if (/syncAes|syncClient|syncPayload|sync-aes|sync-client|sync-payload|from '\.\/secret/.test(c)) {
        remaining.push(path.relative(root, full));
      }
    }
  }
})(src);

if (remaining.length) {
  console.log('  ⚠️ 仍有引用：');
  remaining.forEach((r) => console.log('     ' + r));
} else {
  console.log('  ✔ 没有残留引用');
}
