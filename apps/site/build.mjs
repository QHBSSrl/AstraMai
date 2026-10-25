/**
 * 官网构建。
 *
 * ── 为什么是「一个纯 Node 脚本」而不是 Vite/Astro ──────────────────
 *
 * 这个站只有一页，唯一需要"构建"的地方是**把 CHANGELOG.md 转成 HTML**
 * —— 让更新日志只有一份来源，不用每次发版去两个地方改。
 *
 * 为这一件事引入打包器不值得：多一堆依赖、多一个构建步骤要记、
 * 多一个会坏的地方。`node build.mjs` 就够了。
 *
 * ── 做了什么 ────────────────────────────────────────────────────────
 *
 *   1. 读 CHANGELOG.md，转成 HTML 片段
 *   2. 读 manifest.json 拿版本号，替换模板里的 {{VERSION}}
 *   3. 输出 dist/index.html + style.css + icon.svg
 *
 * 用法：node apps/site/build.mjs
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIST = resolve(HERE, 'dist');

// ══════════════════════════════════════════════════════════════════════
// Markdown → HTML（只支持 CHANGELOG 用到的子集）
// ══════════════════════════════════════════════════════════════════════

/** 转义，防止 CHANGELOG 里的尖括号被当标签。 */
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
 * 顺序有讲究：先处理行内代码，把它们替换成占位符，
 * 否则 `**` 出现在代码里会被当成粗体。
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

  return out.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
}

/**
 * 整个文档。
 *
 * ⚠️ CHANGELOG 里所有的大标题都是 `##`（一级 `#` 是文档标题，丢掉了），
 * 而页面里 `##` 表示"一个版本"，`###` 表示"版本里的一个方面"。
 * 所以 `##` 直接输出成 `<h2>`，不做层级调整。
 */
function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];

  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', items: string[] }
  let quote = [];
  let skipFirstHeading = false;

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

    // 空行
    if (!line.trim()) {
      flushAll();
      continue;
    }

    // 一级标题：文档名，跳过（页面自己有 h1）
    if (/^#\s+/.test(line) && !skipFirstHeading) {
      skipFirstHeading = true;
      flushAll();
      continue;
    }

    // 分隔线
    if (/^---+\s*$/.test(line)) {
      flushAll();
      out.push('<hr />');
      continue;
    }

    // 标题
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }

    // 列表
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

    // 续行（缩进的列表项第二行）
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
  const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'apps/vela/src/manifest.json'), 'utf8'));
  const template = readFileSync(resolve(HERE, 'template.html'), 'utf8');

  const version = String(manifest.versionName);
  // 开发版（带 debug 后缀）在官网上显示成「正在开发」，不要暴露奇怪的版本号
  const displayVersion = /debug/i.test(version) ? `${version}（开发版）` : version;

  const html = template
    .replace('{{CHANGELOG}}', markdownToHtml(changelog))
    .replace(/\{\{VERSION\}\}/g, displayVersion);

  mkdirSync(DIST, { recursive: true });
  writeFileSync(resolve(DIST, 'index.html'), html, 'utf8');
  copyFileSync(resolve(HERE, 'style.css'), resolve(DIST, 'style.css'));
  writeFileSync(resolve(DIST, 'icon.svg'), ICON, 'utf8');

  // 没有路由，但有些抓取工具会问 robots.txt
  writeFileSync(resolve(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`  ✅ dist/index.html  ${kb} KB`);
  console.log(`  版本：${displayVersion}`);
}

main();
