const fs = require('fs');
const path = require('path');

/**
 * 手环版去掉「二维码」功能。
 *
 * 为什么手环不要：机台二维码要靠手机或电脑导入（贴纸/截图识别），
 * 手环既不能扫码也不能粘贴，这一页对它只是摆设。
 *
 * 删的东西：
 *   · src/pages/Qr/          二维码页
 *   · manifest 里的路由
 *   · 首页的「二维码」入口和 qrInput 相关读取
 *
 * 保留：`welcome.ux` 里的二维码是**群分享二维码**，和这个功能无关。
 */
const root = __dirname + '/vela-band';

/* ── 1. 删页面目录 ───────────────────────────────────────────────── */
const qrDir = path.join(root, 'src', 'pages', 'Qr');
if (fs.existsSync(qrDir)) {
  fs.rmSync(qrDir, { recursive: true, force: true });
  console.log('  rm src/pages/Qr');
}

/* ── 2. manifest 去掉路由 ────────────────────────────────────────── */
const mf = path.join(root, 'src', 'manifest.json');
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
if (m.router && m.router.pages && m.router.pages['pages/Qr']) {
  delete m.router.pages['pages/Qr'];
  fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log('  manifest 去掉 pages/Qr，剩 ' + Object.keys(m.router.pages).length + ' 页');
}

/* ── 3. 首页：去掉二维码条目和相关读取 ───────────────────────────── */
const idx = path.join(root, 'src', 'pages', 'Index', 'index.ux');
let s = fs.readFileSync(idx, 'utf8');

// warmUp 列表里去掉 qrInput
s = s.replace(
  /warmUp\(\['qrInput', /,
  "warmUp(['",
);

// 去掉二维码入口
s = s.replace(/[ \t]*if \(showQr\) items\.push\(\{ key: 'qr', title: '二维码' \}\);\r?\n/, '');

// 去掉 showQr 判定
s = s.replace(/[ \t]*const showQr = gameHasFeature\(game, 'qr'\);\r?\n/, '');

// 去掉整段 qrInput 读取（从 const saved 到 if/else 结束）
s = s.replace(
  /[ \t]*const saved = readSetting\('qrInput', ''\);\r?\n[\s\S]*?this\.qrSummary = validity\.state === 'valid' \? '有效' : '已过期';\r?\n[ \t]*\}\r?\n[ \t]*\}\r?\n/,
  '',
);

// private 里的 qrSummary 也没用了
s = s.replace(/[ \t]*qrSummary: '未导入',\r?\n/, '');

fs.writeFileSync(idx, s, 'utf8');
console.log(
  '  index.ux 清理完成（残留：' +
    (s.match(/qrSummary|showQr|qrInput|'qr'/) ? '有 ⚠️' : '无') +
    '）',
);

/* ── 4. 自检 ─────────────────────────────────────────────────────── */
const leftover = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(js|ux)$/.test(name)) {
      const c = fs.readFileSync(full, 'utf8');
      // welcome.ux 的群二维码不算
      if (full.endsWith('welcome.ux')) continue;
      if (/pages\/Qr|push\('\/qr'\)|showQr/.test(c)) leftover.push(path.relative(root, full));
    }
  }
})(path.join(root, 'src'));

if (leftover.length) {
  console.log('  ⚠️ 仍有引用：');
  leftover.forEach((x) => console.log('     ' + x));
} else {
  console.log('  ✔ 没有残留引用');
}
