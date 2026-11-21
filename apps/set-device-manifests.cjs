const fs = require('fs');
const path = require('path');

/**
 * 三处调整：
 *
 *   1. apps/vela        → RW（REDMI Watch 5，方形 432×514）
 *   2. apps/vela-watch  → 小米 Watch（圆形 466×466）
 *   3. 各自改包名，避免 AstroBox 里互相覆盖
 *
 * 屏幕参数来自官方《多屏适配》表格：
 *
 *   Xiaomi Watch S3/S4/H1   圆形  466×466
 *   REDMI Watch 5           方形  432×514
 *   手环 9/10/11            跑道  192×490 / 212×520
 *   手环 9/10 Pro           长方  336×480
 */
const targets = [
  {
    dir: 'vela',
    width: 432,
    pkg: 'com.nowmes.orhythm',
    name: 'ORhythm',
    note: 'RW 方形',
  },
  {
    dir: 'vela-watch',
    width: 466,
    pkg: 'com.nowmes.orhythm.watch',
    name: 'ORhythm Watch',
    note: '小米 Watch 圆形',
  },
  {
    dir: 'vela-band',
    width: 192,
    pkg: 'com.nowmes.orhythm.band',
    name: 'ORhythm 手环',
    note: '手环 跑道型',
  },
  {
    dir: 'vela-bandpro',
    width: 336,
    pkg: 'com.nowmes.orhythm.bandpro',
    name: 'ORhythm 手环 Pro',
    note: '手环 Pro 长方形',
  },
];

// 这个脚本就放在 apps/ 下，所以 __dirname 就是 apps 本身
const root = __dirname;

for (const t of targets) {
  const f = path.join(root, t.dir, 'src', 'manifest.json');
  if (!fs.existsSync(f)) {
    console.log('  ⚠️ 跳过 ' + t.dir + '（没有 manifest）');
    continue;
  }
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  m.package = t.pkg;
  m.name = t.name;
  m.config.designWidth = t.width;
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log(
    '  ✔ ' +
      t.dir.padEnd(14) +
      ' ' +
      String(t.width).padEnd(4) +
      ' ' +
      t.pkg.padEnd(32) +
      ' ' +
      t.note,
  );
}
