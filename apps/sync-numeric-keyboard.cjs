const fs = require('fs');
const path = require('path');

/**
 * 把「数字键盘 + 键盘上的收起键」同步到所有 Vela 项目。
 *
 * 手环版已经手工改好了，这个脚本负责剩下三个：
 *
 *     apps/vela        RW 方形 432
 *     apps/vela-watch  小米 Watch 圆形 466
 *     apps/vela-bandpro 手环 Pro 336
 *
 * 每个项目都有一份**独立的 InputMethod 组件副本**（当初按设备拆项目时
 * 整份复制过去的），所以四处都要改。
 *
 * 改动内容（和手环版一致）：
 *   ① InputMethod 加 `numeric` prop → 一进来就是数字盘
 *   ② 数字盘第三行末尾加一个「收」键，点击 emit `hidekeyboard`
 *   ③ B50 页面：传 `numeric="true"`、监听 `@hidekeyboard`、
 *      去掉页面上那个「输入/收起」按钮
 */
const ROOT = __dirname;

const projects = ['vela', 'vela-watch', 'vela-bandpro'];

let touched = 0;

for (const project of projects) {
  const base = path.join(ROOT, project);
  if (!fs.existsSync(base)) {
    console.log(`  · ${project} 不存在，跳过`);
    continue;
  }

  /* ── ① InputMethod：加 numeric prop ─────────────────────────── */
  const comp = path.join(base, 'src', 'components', 'InputMethod', 'InputMethod.ux');
  if (fs.existsSync(comp)) {
    let s = fs.readFileSync(comp, 'utf8');
    let changed = false;

    if (!s.includes('numeric: {')) {
      // 插在 screentype prop 之前
      s = s.replace(
        /(\n\s+screentype: \{)/,
        `
    /*
     * 是否**直接进数字模式**。
     *
     * 好友码和 QQ 号都是纯数字，用 QWERTY 纯属浪费 ——
     * 原来只能靠键盘上的 \`123\` 键切，页面没法指定初始状态。
     */
    numeric: {
      default: false,
    },$1`,
      );
      changed = true;
    }

    if (!s.includes('if (this.numeric)')) {
      s = s.replace(
        /(\n\s+this\.\$watch\("hide", "watchHidePropsChange"\);)/,
        `
    // 一进来就是数字盘（用 numFlag 而不是改 keys —— keys 是共用的）
    if (this.numeric) {
      this.numFlag = true;
      this.numFlag_jp = false;
    }
$1`,
      );
      changed = true;
    }

    /* ── ② 数字盘加「收」键 ──────────────────────────────────── */
    if (!s.includes('hideKeyboard')) {
      s = s.replace(/(\n\s+addAllTxt\(txt\) \{)/, `
  /**
   * 收起键盘。
   *
   * 键盘上有个「收」键直接调它 —— 用户不用再跑到页面上方找
   * 「收起」按钮。
   */
  hideKeyboard() {
    this.$emit("hidekeyboard", {});
  },
$1`);
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(comp, s, 'utf8');
      console.log(`  ✔ ${project} InputMethod（prop + 方法）`);
      touched += 1;
    }
  }

  /* ── ③ B50 页面接线 ────────────────────────────────────────── */
  const page = path.join(base, 'src', 'pages', 'B50', 'b50.ux');
  if (!fs.existsSync(page)) continue;

  let s = fs.readFileSync(page, 'utf8');
  const before = s.length;

  // 传 numeric
  if (s.includes('<input-method') && !s.includes('numeric=')) {
    s = s.replace(/(<input-method\s*\n)/, `$1      numeric="{{ true }}"\n`);
  }

  // 监听 hidekeyboard
  if (s.includes('@delete="onDelete"') && !s.includes('@hidekeyboard')) {
    s = s.replace(/(@delete="onDelete"\s*\n)/, `$1      @hidekeyboard="onHideKeyboard"\n`);
  }

  // 加处理方法
  if (!s.includes('onHideKeyboard')) {
    s = s.replace(/(\n\s+toggleKeyboard\(\) \{)/, `
    /** 键盘上的「收」键按了 —— 直接收起。 */
    onHideKeyboard() {
      this.keyboardHidden = true;
    },
$1`);
  }

  // 去掉页面上的「输入/收起」按钮
  const ghostRe = /[ \t]*<div class="action action--ghost"[^>]*toggleKeyboard[^>]*>[\s\S]*?<\/div>\r?\n/;
  if (ghostRe.test(s)) {
    s = s.replace(ghostRe, '');
  }

  if (s.length !== before) {
    fs.writeFileSync(page, s, 'utf8');
    console.log(`  ✔ ${project} b50.ux 接线`);
    touched += 1;
  }
}

console.log(`\n  共改 ${touched} 处`);
