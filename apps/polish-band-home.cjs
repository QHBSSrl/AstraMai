const fs = require('fs');
const path = require('path');

/**
 * 修两个问题：
 *
 * ① 品牌字没上主题色
 *
 *    用户的设计稿里 ORhythm 是白色的，但那只是演示稿 —— 他没给部分文字
 *    上色不代表不要色。手表版一直是 `@ui-primary`（#ff5f9e 粉），
 *    这里跟着对齐。
 *
 * ② 设置按钮用了 `⚙` 字符，实机上渲染成方块（缺字形）
 *
 *    干脆用「设置」两个字 —— 中文字形设备一定有，也更好懂。
 *
 * 宽度要算一下：手环内容区只有 192 - 14×2 = 164px。
 *    品牌 24px × 8 字符 ≈ 104px
 *    设置按钮 15px 两字 + 内边距 ≈ 52px
 *    合计 156px，留 8px 余量，够。
 * 手环 Pro 内容区 336 - 20×2 = 296px，更宽裕。
 */
const jobs = [
  {
    file: 'vela-band/src/pages/Index/index.ux',
    brandSize: 24,
    btnMinWidth: 52,
    btnHeight: 40,
    btnFont: 15,
    btnPad: 10,
  },
  {
    file: 'vela-bandpro/src/pages/Index/index.ux',
    brandSize: 38,
    btnMinWidth: 88,
    btnHeight: 56,
    btnFont: 22,
    btnPad: 18,
  },
];

// 脚本就在 apps/ 下
const root = __dirname;

for (const job of jobs) {
  const f = path.join(root, job.file);
  let s = fs.readFileSync(f, 'utf8');

  // ── ① 设置按钮：⚙ → 设置 ──
  s = s.replace(
    /<text class="settings-btn__text">⚙<\/text>/,
    '<text class="settings-btn__text">设置</text>',
  );

  // ── ② 品牌字改成主题色 ──
  s = s.replace(
    /(\.brand \{[^}]*?color:\s*)@ui-on-surface;/,
    '$1@ui-primary;',
  );

  // ── ③ 设置按钮改成能放下「设置」两字的胶囊 ──
  s = s.replace(
    /(\.settings-btn \{[^}]*?)width:\s*\d+px;\s*\n(\s*)height:\s*\d+px;/,
    (m, head, indent) =>
      head +
      `min-width: ${job.btnMinWidth}px;\n` +
      `${indent}height: ${job.btnHeight}px;\n` +
      `${indent}padding: 0 ${job.btnPad}px;`,
  );
  s = s.replace(
    /(\.settings-btn__text \{\s*\n\s*font-size:\s*)\d+px;/,
    `$1${job.btnFont}px;`,
  );

  // ── ④ 品牌字号微调，保证和按钮放得下 ──
  s = s.replace(
    /(\.brand \{\s*\n\s*font-size:\s*)\d+px;/,
    `$1${job.brandSize}px;`,
  );

  fs.writeFileSync(f, s, 'utf8');
  console.log('  ✔ ' + job.file);
}
