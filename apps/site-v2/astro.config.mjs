import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'static',

  /*
   * 正式域名。
   *
   * 用来生成 canonical / og:url 这种绝对地址 —— 社交平台抓取时
   * 需要完整 URL，相对路径它不认。
   *
   * ⚠️ 两个域名都指向同一个 Cloudflare Pages 项目，
   * 主用 astranexus.cn，astnx.com 是备用。
   */
  site: 'https://orhythm.astranexus.cn',
  vite: {
    plugins: [tailwindcss()],
  },
});
