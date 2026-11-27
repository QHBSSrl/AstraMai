const fs = require('fs');
const path = require('path');

/**
 * 在数字盘的第三行末尾插入「收」键（收起键盘）。
 *
 * 四个项目各有一份 InputMethod 副本，手环版已经手工加过了，
 * 这个脚本负责剩下三个，并且**可以重复执行**（已有就跳过）。
 */
const ROOT = __dirname;
const projects = ['vela', 'vela-watch', 'vela-bandpro', 'vela-band'];

for (const project of projects) {
  const file = path.join(ROOT, project, 'src', 'components', 'InputMethod', 'InputMethod.ux');
  if (!fs.existsSync(file)) continue;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  // 已经有就跳过
  if (lines.some((l) => l.includes('@click="hideKeyboard"'))) {
    console.log(`  · ${project} 已有收起键`);
    continue;
  }

  const out = [];
  let added = 0;

  for (const line of lines) {
    out.push(line);

    // 只认数字行（keys['sign']），不碰 QWERTY
    if (/keys\['sign'\]\[2\]/.test(line)) {
      const cls = line.includes('calbtn66') ? 'calbtn66' : 'calbtn67';
      out.push('              <!-- 收起键盘的键放在第三行数字右边 -->');
      out.push('              <div static style="margin-left: 96px;margin-top: -5px;height: 60px;">');
      out.push(`                <text class="${cls}" @click="hideKeyboard">收</text>`);
      out.push('              </div>');
      added += 1;
    }
  }

  fs.writeFileSync(file, out.join('\n'), 'utf8');
  console.log(`  ✔ ${project} 加了 ${added} 处收起键`);
}
