/**
 * 官网构建。
 *
 * ── 为什么是「一个纯 Node 脚本」而不是 Vite/Astro ──────────────────
 *
 * 这个站只有几页静态内容，唯一需要"构建"的地方是**把 CHANGELOG.md 转成
 * HTML** —— 让更新日志只有一份来源，发版不用去两个地方改。
 *
 * 为这一件事引入打包器不值得：多一堆依赖、多一个构建步骤要记、
 * 多一个会坏的地方。`node build.mjs` 就够了。
 *
 * ── 结构 ────────────────────────────────────────────────────────────
 *
 *   layout.html        页面骨架（导航 / 页脚 / meta）
 *   pages/*.html       每页的内容片段，只有正文
 *   build.mjs          把片段塞进骨架，输出 dist/*.html
 *
 * 拆成多页而不是单页长滚动：内容已经不少了，一页滚下来找东西很难受，
 * 而且静态托管多几个 html 不要钱。
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIST = resolve(HERE, 'dist');
const PAGES = resolve(HERE, 'pages');

/** 页面 key → 导航高亮用的占位符名。 */
const NAV_KEY = {
  index: '',
  games: 'NAV_GAMES',
  features: 'NAV_FEATURES',
  changelog: 'NAV_CHANGELOG',
  faq: 'NAV_FAQ',
  download: 'NAV_DOWNLOAD',
};

/** 每页的 title / description。没列出来的用兜底。 */
const META = {
  index: {
    title: 'AstraMai —— 把你的音游成绩戴在手腕上',
    description:
      'AstraMai 是跑在小米手表和手环上的音游查分工具，支持舞萌 DX、中二节奏、Phigros、osu!。抬腕查 Best、推分计算、成绩对比、离线缓存。基础功能全免费。',
  },
  games: {
    title: '支持的游戏 · AstraMai',
    description: '舞萌 DX 的 Best 50、中二节奏的 Best 30、Phigros 的 RKS、osu! 的 Best Plays —— 四个游戏，每个都说清楚能查什么。',
  },
  features: {
    title: '功能 · AstraMai',
    description: '推分计算器、成绩对比、离线缓存、距下一档、同步到手表。查分谁都会做，这几样是别人没有的。',
  },
  download: {
    title: '下载 · AstraMai',
    description: '在 AstroBox 里搜索 AstraMai 即可安装。小米手表 Watch S3 及以后、小米手环 8 Pro 及以上都能用。',
  },
  changelog: {
    title: '更新日志 · AstraMai',
    description: 'AstraMai 每个版本都写了为什么做，不只是列功能。',
  },
  faq: {
    title: '常见问题 · AstraMai',
    description: '要钱吗、数据安全吗、为什么不支持 Arcaea、支持哪些设备、一定要联网吗。',
  },
};

// ══════════════════════════════════════════════════════════════════════
// Markdown → HTML（只支持 CHANGELOG 用到的子集）
// ══════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 行内格式：`code`、**粗体**、[链接](url)。
 *
 * 顺序有讲究：先把行内代码抠成占位符，否则代码里的 `**`
 * 会被当成粗体起点，或者 `<` 被转义两次。
 */
function inline(text) {
  const codes = [];

  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  out = escapeHtml(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );

  return out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

/** 整个 Markdown 文档。 */
function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];

  let paragraph = [];
  let list = null;
  let quote = [];
  let skippedTitle = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>`);
    for (const item of list.items) out.push(`<li>${inline(item)}</li>`);
    out.push(`</${list.type}>`);
    list = null;
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    // 一级标题是文档名，页面自己有 h1，跳过
    if (/^#\s+/.test(line) && !skippedTitle) {
      skippedTitle = true;
      flushAll();
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      flushAll();
      out.push('<hr />');
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const type = bullet ? 'ul' : 'ol';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((bullet ?? ordered)[1]);
      continue;
    }

    // 缩进的续行，接到上一个列表项
    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  flushAll();
  return out.join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// 构建
// ══════════════════════════════════════════════════════════════════════

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#070b16"/>
  <circle cx="32" cy="32" r="17" fill="none" stroke="#4fd6ff" stroke-width="3"/>
  <circle cx="32" cy="32" r="5" fill="#ff5f9e"/>
  <path d="M32 15v-6M32 55v-6M15 32h-6M55 32h-6" stroke="#4fd6ff" stroke-width="3" stroke-linecap="round"/>
</svg>
`;

function main() {
  const changelogHtml = markdownToHtml(readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'apps/vela/src/manifest.json'), 'utf8'));
  const layout = readFileSync(resolve(HERE, 'layout.html'), 'utf8');

  const version = String(manifest.versionName);
  // 开发版在官网上显示成「0.1.3debug1（开发版）」，不要裸奔奇怪版本号
  const displayVersion = /debug/i.test(version) ? `${version}（开发版）` : version;

  mkdirSync(DIST, { recursive: true });

  const names = readdirSync(PAGES).filter((name) => name.endsWith('.html'));
  const built = [];

  for (const name of names) {
    const key = name.replace(/\.html$/, '');
    const meta = META[key] ?? { title: 'AstraMai', description: '腕上音游工具。' };

    let content = readFileSync(join(PAGES, name), 'utf8');
    content = content.replace(/\{\{CHANGELOG\}\}/g, changelogHtml);

    let html = layout
      .replace(/\{\{TITLE\}\}/g, escapeHtml(meta.title))
      .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(meta.description))
      .replace(/\{\{CONTENT\}\}/g, content)
      .replace(/\{\{VERSION\}\}/g, displayVersion);

    // 导航高亮：当前页的占位符填 active，其余清空
    for (const [pageKey, placeholder] of Object.entries(NAV_KEY)) {
      if (!placeholder) continue;
      const value = pageKey === key ? 'active' : '';
      html = html.replace(new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g'), value);
    }
    // download 页的 CTA 也要高亮
    html = html.replace(/\{\{NAV_DOWNLOAD\}\}/g, '');

    // 有残留占位就是有地方漏配了，直接报错别悄悄发出去
    const leftover = /\{\{[A-Z_]+\}\}/.exec(html);
    if (leftover) {
      throw new Error(`${name} 还有没替换的占位符：${leftover[0]}`);
    }

    writeFileSync(resolve(DIST, name), html, 'utf8');
    built.push(`${name} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
  }

  copyFileSync(resolve(HERE, 'style.css'), resolve(DIST, 'style.css'));
  writeFileSync(resolve(DIST, 'icon.svg'), ICON, 'utf8');
  writeFileSync(resolve(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
  // Cloudflare Pages 的自定义 404
  writeFileSync(
    resolve(DIST, '404.html'),
    layout
      .replace(/\{\{TITLE\}\}/g, '页面不存在 · AstraMai')
      .replace(/\{\{DESCRIPTION\}\}/g, '这个页面不存在。')
      .replace(
        /\{\{CONTENT\}\}/g,
        `      <section class="section section--top">
        <h1 class="page__title">这个页面不存在</h1>
        <p class="section__lead">可能是链接输错了，或者页面改名了。</p>
        <p><a class="btn btn--primary" href="./">回首页</a></p>
      </section>`,
      )
      .replace(/\{\{VERSION\}\}/g, displayVersion)
      .replace(/\{\{NAV_[A-Z]+\}\}/g, ''),
    'utf8',
  );

  console.log(`  ✅ 生成 ${built.length + 1} 个页面`);
  for (const item of built) console.log(`     ${item}`);
  console.log(`     404.html`);
  console.log(`  版本：${displayVersion}`);
}

main();
