const fs = require('fs');
const path = require('path');

/**
 * 设置页：游戏选择去掉「当前」文字标记，只用颜色区分选中。
 *
 * 用户要求：「你把当前去掉，只需要颜色作为选中提示就好了」
 *
 * ── 改动 ────────────────────────────────────────────────────────
 *
 * 改前：
 *     舞萌 DX                    当前
 *     中二节奏
 *
 * 改后：
 *     舞萌 DX          ← 主色（#ff5f9e）+ 加粗
 *     中二节奏         ← 常规文字色
 *
 * 顺带把选中色从 `#4fd6ff`（蓝）换成主题粉 `#ff5f9e` ——
 * 蓝色是当初一个临时值，和整个 App 的配色不一致。
 *
 * 四个项目都要改：设置页是各项目里独立的一份。
 */
const ROOT = __dirname;
const projects = ['vela', 'vela-band', 'vela-watch', 'vela-bandpro'];

const ON_COLOR = '#ff5f9e';
const OFF_COLOR = '#e8eefc';

for (const project of projects) {
  const file = path.join(ROOT, project, 'src', 'pages', 'Settings', 'settings.ux');
  if (!fs.existsSync(file)) continue;

  let s = fs.readFileSync(file, 'utf8');
  const before = s.length;

  // ① 去掉「当前」那一行
  s = s.replace(
    /[ \t]*<text class="row__mark" if="\{\{ \$item\.current \}\}">当前<\/text>\r?\n/,
    '',
  );

  // ② 选中态用主题粉 + 加粗
  s = s.replace(
    /<text class="row__label" style="color: \{\{ \$item\.current \? '#4fd6ff' : '#e8eefc' \}\}">\{\{ \$item\.label \}\}<\/text>/,
    `<text class="row__label" style="color: {{ $item.current ? '${ON_COLOR}' : '${OFF_COLOR}' }}; font-weight: {{ $item.current ? 'bold' : 'normal' }}">{{ $item.label }}</text>`,
  );

  // ③ 注释说明
  s = s.replace(
    /([ \t]*)<!-- 游戏切换 -->/,
    `$1<!--
$1  游戏切换：选中项只靠**颜色**表示（主题粉 + 加粗），
$1  不再加「当前」两个字 —— 手环屏幕窄，那两个字把游戏名挤掉一截。
$1-->`,
  );

  if (s.length !== before) {
    fs.writeFileSync(file, s, 'utf8');
    const stillHas = s.includes('>当前<');
    console.log(`  ✔ ${project}${stillHas ? '  ⚠️ 还有「当前」' : ''}`);
  } else {
    console.log(`  · ${project} 没变化（可能已改过）`);
  }
}
