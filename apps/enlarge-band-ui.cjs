const fs = require('fs');
const path = require('path');

/**
 * 手环首页整体放大一档（**分数卡片不动**）。
 *
 * ── 高度预算（屏高 490）──────────────────────────────────────────
 *
 *   上下内边距      24 × 2            = 48
 *   品牌            ~40
 *   卡片 margin-top  14
 *   分数卡片        ~128（没动）
 *   快捷标题        ~42
 *   3 行 × 62 + 2×8 = 202
 *   ─────────────────────────────────
 *   合计            ≈ 474  ≤ 490  ✅
 *
 * 二维码删掉之后只剩 Best 50 / 曲目搜索 / 设置 三行，
 * 正好留出放大的空间。
 *
 * ── 宽度预算（内容区 192 - 12×2 = 168）──────────────────────────
 *
 *   「曲目搜索」26px × 4 字 ≈ 104 + 左右内边距 28 = 132  ✅
 *   「Best 50」26px       ≈ 98  + 28            = 126  ✅
 */
const file = path.join(__dirname, 'vela-band', 'src', 'pages', 'Index', 'index.ux');
let s = fs.readFileSync(file, 'utf8');

/*
 * 只替换分数卡片**之外**的数值。
 *
 * 分数卡片相关的类名是 .game / .game__name / .game__rating /
 * .game__rating-label / .game__hint —— 用户说先不动，所以下面每条
 * 替换都锚定在具体类名上，不会误伤。
 */

const edits = [
  // 页面内边距：左右收一点，换更宽的内容区
  [/(\.page \{[^}]*?padding:\s*)24px 14px;/, '$1' + '24px 12px;'],

  // 品牌 26 → 30
  [/(\.brand \{[^}]*?font-size:\s*)26px;/, '$1' + '30px;'],

  // 快捷标题 14 → 16
  [/(\.section \{[^}]*?font-size:\s*)14px;/, '$1' + '16px;'],

  // 行高 52 → 62
  [/(\.item \{[^}]*?height:\s*)52px;/, '$1' + '62px;'],
  // 行左右内边距 14 → 16
  [/(\.item \{[^}]*?padding:\s*0 )14px;/, '$1' + '16px;'],

  // 行标题 20 → 26
  [/(\.item__title \{[^}]*?font-size:\s*)20px;/, '$1' + '26px;'],
];

for (const [re, rep] of edits) {
  if (!re.test(s)) {
    console.log('  ⚠️ 没匹配到：' + re.source);
    continue;
  }
  s = s.replace(re, rep);
}

fs.writeFileSync(file, s, 'utf8');
console.log('  ✔ ' + path.relative(path.dirname(__dirname), file));

/* 自检：确认分数卡片的数值没被改动 */
const gameBlock = s.match(/\.game \{[\s\S]*?\.game__hint \{[\s\S]*?\}/);
if (gameBlock) {
  const g = gameBlock[0];
  const checks = [
    ['padding: 14px', /padding:\s*14px/],
    ['rating 44px', /font-size:\s*44px/],
    ['name 20px', /font-size:\s*20px/],
  ];
  for (const [label, re] of checks) {
    console.log('  ' + (re.test(g) ? '✔' : '⚠️') + ' 分数卡片 ' + label + ' 未变');
  }
}
