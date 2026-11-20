/**
 * 统一给 Vela 各页面的 `.page` 加安全边距。
 *
 * 背景：手表是圆角屏幕，内容贴边会被物理裁掉。用户反馈「标题和设置按钮
 * 被裁了一部分，而且按钮难点」，其他页面同样有这个问题。
 *
 * 做法：
 *   1. 把 `.page { ... }` 里的 padding 统一成 18px 26px 22px
 *   2. 确保有 `@media (shape: circle)` 且里面把左右加到 40px
 *
 * 只改 padding 这一条声明，不动其它属性。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PAGES = join(ROOT, 'src', 'pages');

const BASE_PADDING = '18px 26px 22px';
const CIRCLE_PADDING = 40;

function findUx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findUx(full));
    else if (name.endsWith('.ux')) out.push(full);
  }
  return out;
}

let changed = 0;

for (const file of findUx(PAGES)) {
  let css = readFileSync(file, 'utf8');
  const before = css;

  // ── 1. 统一 .page 的 padding ──────────────────────────────────────
  const pageRe = /(\.page\s*\{)([\s\S]*?)(\})/;
  const m = css.match(pageRe);
  if (m) {
    let body = m[2];
    if (/padding\s*:[^;]+;/.test(body)) {
      body = body.replace(/padding\s*:[^;]+;/, `padding: ${BASE_PADDING};`);
    } else {
      // 没有 padding 就补一条
      body = `${body.replace(/\s*$/, '')}\n    padding: ${BASE_PADDING};\n  `;
    }
    css = css.replace(pageRe, `${m[1]}${body}${m[3]}`);
  }

  // ── 2. 确保圆屏有这个更强的手距 ──────────────────────────────────
  if (!/@media\s*\(shape:\s*circle\)/.test(css)) {
    // 没有就追加到 style 结束前
    const close = css.lastIndexOf('</style>');
    if (close > 0) {
      const block = `
  /* 圆屏：左右再往里收，避免内容和屏幕边缘相切被裁 */
  @media (shape: circle) {
    .page {
      padding-left: ${CIRCLE_PADDING}px;
      padding-right: ${CIRCLE_PADDING}px;
    }
  }
`;
      css = css.slice(0, close) + block + css.slice(close);
    }
  } else {
    // 有 media 但没有左右手距就补
    const circleRe = /(@media\s*\(shape:\s*circle\)\s*\{)([\s\S]*?)(\n\s*\}\s*\n)/;
    const cm = css.match(circleRe);
    if (cm && !/padding-left/.test(cm[2])) {
      css = css.replace(
        circleRe,
        `${cm[1]}${cm[2]}\n    .page {\n      padding-left: ${CIRCLE_PADDING}px;\n      padding-right: ${CIRCLE_PADDING}px;\n    }${cm[3]}`,
      );
    }
  }

  if (css !== before) {
    writeFileSync(file, css, 'utf8');
    changed += 1;
    console.log(`  ✔ ${file.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
  }
}

console.log(`\n共修改 ${changed} 个页面`);
