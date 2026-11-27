const fs = require('fs');
const path = require('path');

/**
 * 手环版 B50：去掉「好友码 / QQ 号」切换，改成**按长度自动识别**。
 *
 * 用户原话：「直接把 QQ 和好友码切换功能凹了，直接做一个识别。
 * 反正好友码 15 位，你 QQ 最高可能才 11 位」
 *
 * ── 规则 ────────────────────────────────────────────────────────
 *
 *     ≤ 11 位  → QQ 号（QQ 最长 11 位）
 *     ≥ 12 位  → 好友码（15 位）
 *
 * 数字只在 12~14 位时有歧义，但 QQ 根本到不了 12 位，所以没有歧义。
 *
 * ── 边界 ────────────────────────────────────────────────────────
 *
 * · 输入为空时**不改判定**，否则刚进页面标签就莫名其妙变了
 * · 只对「同时支持 qq 和 friendCode」的游戏自动判定；
 *   osu 是用户名（字母），没有这两个选项，保持原样
 * · 切换游戏后 kind 由 onInit 里的逻辑初始化，这里不插手
 */
const file = path.resolve(__dirname, 'vela-band', 'src', 'pages', 'B50', 'b50.ux');
let src = fs.readFileSync(file, 'utf8');

/* ── 1. 模板：删掉切换标签 ────────────────────────────────────── */
const kindsBlock = `        <div class="kinds" if="{{ kinds.length > 1 }}">
          <div class="kind {{ kind === $item.id ? 'kind--on' : '' }}" for="{{ kinds }}" @click="setKind($item.id)">
            <text class="kind__text{{ kind === $item.id ? ' kind__text--on' : '' }}">{{ $item.label }}</text>
          </div>
        </div>

`;

if (!src.includes(kindsBlock)) {
  console.error('  ❌ 没找到 kinds 切换块');
  process.exit(1);
}
src = src.replace(kindsBlock, '');
console.log('  ✔ 模板里删掉了切换标签');

/* ── 2. refreshInputState：先按长度判定，再用 ─────────────────── */
const oldRefresh = `    refreshInputState() {
      const described = describeInput(this.kind, this.code);
      this.hint = described.text + (this.saving ? \` · \${this.saving}\` : '');
      this.canSubmit = isReadyToSubmit(this.kind, this.code);
      this.syncBusy();
      this.displayValue = this.code
        ? this.code
        : \`输入\${KIND_LABELS[this.kind] ?? '好友码'}\`;
    },`;

const newRefresh = `    /**
     * 按长度判定查的是 QQ 号还是好友码。
     *
     *     ≤ 11 位  → QQ（QQ 最长 11 位）
     *     ≥ 12 位  → 好友码（15 位）
     *
     * 只在「同时支持两种」的游戏里生效；osu 是用户名（字母），不参与。
     * 输入为空时保持原判定，免得刚进页面标签就跳。
     */
    detectKind(code) {
      const ids = (this.kinds || []).map((item) => item.id);
      if (ids.indexOf('qq') < 0 || ids.indexOf('friendCode') < 0) return this.kind;

      const digits = String(code || '').replace(/\\D/g, '');
      if (!digits) return this.kind;

      return digits.length >= 12 ? 'friendCode' : 'qq';
    },

    refreshInputState() {
      // 先按当前输入长度定性质，再算提示和可提交状态
      this.kind = this.detectKind(this.code);

      const described = describeInput(this.kind, this.code);
      this.hint = described.text + (this.saving ? \` · \${this.saving}\` : '');
      this.canSubmit = isReadyToSubmit(this.kind, this.code);
      this.syncBusy();
      this.displayValue = this.code
        ? this.code
        : '好友码 / QQ 号';
    },`;

if (!src.includes(oldRefresh)) {
  console.error('  ❌ 没找到 refreshInputState');
  process.exit(1);
}
src = src.replace(oldRefresh, newRefresh);
console.log('  ✔ refreshInputState 里加了自动判定');

/* ── 3. 样式：kinds 相关的类不再用，删掉 ─────────────────────── */
for (const cls of ['.kinds', '.kind', '.kind--on', '.kind__text', '.kind__text--on']) {
  const re = new RegExp(`[ \\t]*\\${cls.replace(/\./g, '\\.')} \\{[\\s\\S]*?\\n  \\}\\n`, 'g');
  const before = src.length;
  src = src.replace(re, '');
  if (src.length === before) console.log(`  · ${cls} 没删到（可能本来就没有）`);
}
console.log('  ✔ 清掉 kinds 相关样式');

fs.writeFileSync(file, src, 'utf8');

/* 自检 */
const leftovers = ['kinds', 'kind__text', 'setKind'].filter((n) => src.includes(n));
console.log(leftovers.length ? '  ⚠️ 残留：' + leftovers.join(', ') : '  ✔ 没有残留');
const divOpen = (src.match(/<div /g) || []).length;
const divClose = (src.match(/<\/div>/g) || []).length;
console.log(`  ${divOpen === divClose ? '✔' : '⚠️'} <div> ${divOpen} / </div> ${divClose}`);
