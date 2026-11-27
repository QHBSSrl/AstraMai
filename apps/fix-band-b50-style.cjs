const fs = require('fs');
const path = require('path');

/**
 * 手环版 Best 50 —— 成绩行样式改成两行式。
 *
 * 模板已经改了（曲名一行 + 元信息一行，曲绘已移除），
 * 这里把样式对齐，并清掉旧的三栏样式。
 */
const file = path.resolve(__dirname, 'vela-band', 'src', 'pages', 'B50', 'b50.ux');
let s = fs.readFileSync(file, 'utf8');

/** 按类名删掉一个样式块（到下一个两条空格缩进的 } 为止）。 */
function dropBlock(src, cls) {
  const re = new RegExp(`[ \\t]*\\${cls} \\{[\\s\\S]*?\\n  \\}\\n`, 'g');
  return src.replace(re, '');
}

/** 替换一个样式块的整个 body。 */
function replaceBlock(src, cls, body) {
  const re = new RegExp(`([ \\t]*\\${cls} \\{)[\\s\\S]*?(\\n  \\})`);
  if (!re.test(src)) return null;
  return src.replace(re, `${body}\n  }`);
}

/* ── 1. .row：横向 → 纵向两行，高度 82 → 58 ──────────────────── */
const rowRe = /[ \t]*\.row \{[\s\S]*?\n  \}/;
if (rowRe.test(s)) {
  s = s.replace(
    rowRe,
    `  /*
   * 成绩行：两行式。
   *
   * 高度 58 —— 一行曲名（16px）+ 一行元信息（12px）+ 上下留白。
   * 比 432 版的 82 矮，因为去掉了曲绘这个主要高度来源。
   */
  .row {
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 58px;
    padding: 0 8px;
    border-bottom: 1px solid @ui-surface-container;
  }`,
  );
  console.log('  ✔ .row → 两行式');
}

/* ── 2. .row__title：19 → 16，独占整行 ───────────────────────── */
s = replaceBlock(
  s,
  '.row__title',
  `  .row__title {
    font-size: 16px;
    color: @ui-on-surface;
    lines: 1;
    text-overflow: ellipsis;
  }`,
);
console.log('  ✔ .row__title');

/* ── 3. 新增 .row__meta / .row__left ─────────────────────────── */
if (!s.includes('.row__meta')) {
  s = s.replace(
    /([ \t]*\.row__title \{[\s\S]*?\n  \}\n)/,
    `$1
  /* 第二行：左边 #排名 难度 定数，右边达成率 */
  .row__meta {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-top: 2px;
  }

  .row__left {
    font-size: 12px;
    color: @ui-on-surface-variant;
    lines: 1;
    text-overflow: ellipsis;
  }
`,
  );
  console.log('  ✔ 新增 .row__meta / .row__left');
}

/* ── 4. 删掉不再用的三栏样式 ─────────────────────────────────── */
for (const cls of ['.row__rank', '.row__main', '.row__sub', '.row__version', '.row__right', '.row__rating', '.row__cover']) {
  s = dropBlock(s, cls);
}

/* ── 5. .row__ach 字号 15 → 12 ───────────────────────────────── */
s = replaceBlock(
  s,
  '.row__ach',
  `  .row__ach {
    font-size: 12px;
    color: @ui-on-surface-variant;
  }`,
);

fs.writeFileSync(file, s, 'utf8');

/* 自检 */
const dead = ['row__rank', 'row__main', 'row__sub', 'row__version', 'row__right', 'row__rating', 'row__cover']
  .filter((n) => s.includes(n));
console.log(dead.length ? '  ⚠️ 残留：' + dead.join(', ') : '  ✔ 旧的类已清干净');
console.log('  ' + (s.includes('.row__meta') ? '✔' : '⚠️') + ' .row__meta 存在');
