const fs = require('fs');
const path = require('path');

/**
 * 手环版 Best 50 成绩行重排。
 *
 * ── 为什么不能沿用 432 那套 ────────────────────────────────────────
 *
 * 432 宽时的横向预算：
 *
 *     432 − 28(页边距) − 40(排名) − 64(封面) − 92(右侧) − 16(内边距)
 *     = 174px 给曲名
 *
 * 手环只有 192 宽，把同样的东西塞进去：
 *
 *     192 − 16(页边距) − 24(排名) − 52(右侧) − 8 = 92px 给曲名
 *
 * 92px 在 16px 字号下只放得下 5 个汉字，日文曲名基本全靠省略号。
 *
 * ── 改成两行式 ──────────────────────────────────────────────────
 *
 *     ┌──────────────────────────┐
 *     │ 曲名一行，占满宽度          │
 *     │ #1 EXP 13.2      100.5%   │
 *     └──────────────────────────┘
 *
 * 曲名拿到完整的 176px（约 11 个汉字），第二行塞排名/难度/定数/达成率。
 *
 * ── 曲绘按用户要求去掉 ──────────────────────────────────────────
 *
 * 「米环标准版不要乐曲封面，因为用不上还卡资源」——
 * 不只是不显示，是**根本不创建 `<image>` 节点**，也不请求那张图。
 *
 * ── 曲绘图也不下发 ─────────────────────────────────────────────
 * 服务端的 compact 端点本来就不返回 jacketUrl，所以模板里删掉之后，
 * 既不会渲染也不会多一次请求。
 */
const root = path.resolve(__dirname, 'vela-band');
const file = path.join(root, 'src', 'pages', 'B50', 'b50.ux');
let s = fs.readFileSync(file, 'utf8');

/* ── 1. 模板：两行式，去掉曲绘 ────────────────────────────────── */
const oldItem = `        <list-item class="row" type="item" for="{{ entries }}" @click="openPush($item)">
          <text class="row__rank">{{ $idx + 1 }}</text>
          <!-- 没有图就不渲染：Phigros 平台不提供曲绘，渲染空的 <image> 会显示成灰块 -->
          <image class="row__cover" if="{{ $item.jacketUrl }}" src="{{ $item.jacketUrl }}"></image>
          <div class="row__main">
            <text class="row__title">{{ $item.title }}</text>
            <text class="row__sub" style="color: {{ $item.diffColor }}">{{ $item.difficulty }} · {{ levelLabel }} {{ $item.levelValue }}</text>
            <text class="row__version">{{ versionPrefix }} {{ $item.versionTitle }}</text>
          </div>
          <div class="row__right">
            <text class="row__rating">{{ $item.rating }}</text>
            <text class="row__ach">{{ $item.achievements }}</text>
          </div>
        </list-item>`;

const newItem = `        <!--
          手环成绩行：两行式，**不渲染曲绘**。

          192 宽的状态下列表行的横向预算：
            192 − 16(页边距) − 8(行内边距) = 176px
          如果照 432 那版塞「排名 + 曲名 + 右侧」三栏，曲名只剩 92px，
          约 5 个汉字，日文曲名全靠省略号。

          所以改成两行：
            第一行  曲名，独占整行（约 11 个汉字）
            第二行  排名 · 难度 · 定数       达成率

          曲绘按用户要求直接不写 <image> —— 不创建节点、不请求图片。
          服务端的 compact 端点本来也不返回 jacketUrl。
        -->
        <list-item class="row" type="item" for="{{ entries }}" @click="openPush($item)">
          <text class="row__title">{{ $item.title }}</text>
          <div class="row__meta">
            <text class="row__left">#{{ $idx + 1 }} <text style="color: {{ $item.diffColor }}">{{ $item.difficulty }}</text> {{ $item.levelValue }}</text>
            <text class="row__ach">{{ $item.achievements }}</text>
          </div>
        </list-item>`;

if (!s.includes(oldItem)) {
  console.error('  ❌ 没找到原始成绩行模板，内容可能已被改动');
  process.exit(1);
}
s = s.replace(oldItem, newItem);
console.log('  ✔ 模板改成两行式，曲绘已移除');

/* ── 2. 样式 ──────────────────────────────────────────────────── */
const oldRowStyle = /[ \t]*\.row \{[\s\S]*?\n  \}/;
const newRowStyle = `  /*
   * 成绩行。
   *
   * 高度 58：一行曲名（16px）+ 一行元信息（12px）+ 上下内边距。
   * 比 432 版的 82 矮，因为去掉了曲绘这个主要的高度来源。
   */
  .row {
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 58px;
    padding: 0 8px;
    border-bottom: 1px solid @ui-surface-container;
  }

  .row__title {
    font-size: 16px;
    color: @ui-on-surface;
    lines: 1;
    text-overflow: ellipsis;
  }

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

  .row__ach {
    font-size: 12px;
    color: @ui-on-surface-variant;
  }`;

if (!oldRowStyle.test(s)) {
  console.error('  ❌ 没找到 .row 样式块');
  process.exit(1);
}
s = s.replace(oldRowStyle, newRowStyle);
console.log('  ✔ 样式改成两行式');

/* ── 3. 删掉不再用到的类（曲绘 / 排名 / 右侧 / 版本）──────────── */
const dead = ['.row__cover', '.row__rank', '.row__main', '.row__sub', '.row__version', '.row__right', '.row__rating'];
let removed = 0;
for (const cls of dead) {
  const re = new RegExp(`[ \\t]*${cls.replace('.', '\\.')} \\{[\\s\\S]*?\\n  \\}\\n`, 'g');
  const before = s.length;
  s = s.replace(re, '');
  if (s.length !== before) removed += 1;
}
console.log(`  ✔ 清掉 ${removed} 个不再用的样式块`);

fs.writeFileSync(file, s, 'utf8');

/* ── 4. 自检 ──────────────────────────────────────────────────── */
const left = ['row__cover', 'row__rank', 'row__main', 'row__sub', 'row__version', 'row__right', 'row__rating']
  .filter((n) => s.includes(n));
if (left.length) console.log('  ⚠️ 还有残留：' + left.join(', '));
else console.log('  ✔ 没有残留引用');

const divOpen = (s.match(/<div /g) || []).length;
const divClose = (s.match(/<\/div>/g) || []).length;
console.log(`  ${divOpen === divClose ? '✔' : '⚠️'} <div> ${divOpen} / </div> ${divClose}`);
