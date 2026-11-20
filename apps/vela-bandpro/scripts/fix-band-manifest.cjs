const fs = require('fs');
const path = require('path');

/**
 * 把两个手环项目的 manifest 调成各自的屏幕参数，并去掉端到端加密相关的声明。
 *
 * 屏幕参数来自官方多屏适配文档：
 *   手环 9/10/11（跑道型）     192×490 / 212×520   designWidth 192
 *   手环 9/10 Pro（长方形）    336×480             designWidth 336
 */
const specs = {
  'vela-band': {
    width: 192,
    pkg: 'com.nowmes.orhythm.band',
    name: 'ORhythm 手环',
    types: ['band'],
  },
  'vela-bandpro': {
    width: 336,
    pkg: 'com.nowmes.orhythm.bandpro',
    name: 'ORhythm 手环 Pro',
    types: ['band'],
  },
};

for (const [dir, spec] of Object.entries(specs)) {
  const f = path.join(dir, 'src', 'manifest.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));

  m.package = spec.pkg;
  m.name = spec.name;
  m.config.designWidth = spec.width;
  m.deviceTypeList = spec.types;

  /*
   * 手环不支持端到端加密（@system.crypto 的 AES 那套跑不起来），
   * 所以 sync 功能整个不进去 —— 不是隐藏界面，是**代码和声明都不加载**。
   *
   * 去掉的东西：
   *   · features 里的 system.crypto
   *   · 路由里的 pages/Sync
   */
  m.features = (m.features || []).filter((x) => x && x.name !== 'system.crypto');
  if (m.router && m.router.pages) {
    delete m.router.pages['pages/Sync'];
  }

  fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log(`  ✔ ${dir}  width=${m.config.designWidth}  pkg=${m.package}  页面=${Object.keys(m.router.pages).length}`);
}

/* ── package.json：改名字，避免三条构建混淆 ─────────────────────── */
for (const dir of Object.keys(specs)) {
  const f = path.join(dir, 'package.json');
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  p.name = dir === 'vela-band' ? 'orhythm-vela-band' : 'orhythm-vela-bandpro';
  p.description =
    dir === 'vela-band'
      ? 'ORhythm · 小米手环（跑道型）端'
      : 'ORhythm · 小米手环 Pro（长方形）端';
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n', 'utf8');
  console.log(`  ✔ ${dir}/package.json → ${p.name}`);
}
