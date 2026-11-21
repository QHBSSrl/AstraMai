const fs = require('fs');
const path = require('path');

/**
 * 一条命令把这四个 Vela 项目的设备参数改好。
 *
 * 屏幕参数来自官方《多屏适配》表格和设备参数表：
 *
 *   Xiaomi Watch S3/S4/H1   圆形  466×466
 *   REDMI Watch 5           方形  432×514
 *   手环 9/10/11            跑道  192×490 / 212×520
 *   手环 9/10 Pro           长方  336×480
 *
 * ⚠️ deviceTypeList **必须包含 "watch"**，否则 AIoT IDE 认不出这是 Vela 项目。
 *
 * 扩展 vela.aiot-core 的判定逻辑（反编译 dist/extension.js）：
 *
 *     function projectTypeOf(info) {
 *       const map = { watch: 'vela', phone: 'quickapp' };
 *       for (const k in map) if (info.deviceTypeList?.includes(k)) return map[k];
 *       return 'other';
 *     }
 *
 * 落到 'other' 会抛 `Not support project type of other`，表现就是
 * **调试引导一直转圈、永远进不去**，而且只有日志里才看得到。
 *
 * 手环也属于 watch 类设备，所以两个都写：装得上手环，IDE 也认得。
 */
const targets = [
  {
    dir: 'vela',
    width: 432,
    pkg: 'com.nowmes.orhythm',
    name: 'ORhythm',
    types: ['watch'],
    note: 'RW 方形',
  },
  {
    dir: 'vela-watch',
    width: 466,
    pkg: 'com.nowmes.orhythm.watch',
    name: 'ORhythm Watch',
    types: ['watch'],
    note: '小米 Watch 圆形',
  },
  {
    dir: 'vela-band',
    width: 192,
    pkg: 'com.nowmes.orhythm.band',
    name: 'ORhythm 手环',
    types: ['watch', 'band'],
    note: '手环 跑道型',
  },
  {
    dir: 'vela-bandpro',
    width: 336,
    pkg: 'com.nowmes.orhythm.bandpro',
    name: 'ORhythm 手环 Pro',
    types: ['watch', 'band'],
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
  m.deviceTypeList = t.types;
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log(
    '  ✔ ' +
      t.dir.padEnd(14) +
      ' ' +
      String(t.width).padEnd(4) +
      ' ' +
      t.types.join('+').padEnd(12) +
      ' ' +
      t.pkg.padEnd(32) +
      ' ' +
      t.note,
  );
}
