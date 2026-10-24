import { defineConfig } from 'vite';

/**
 * 同步页的构建配置。
 *
 * `base: './'` 很重要 —— Cloudflare Pages 的服务根路径不是 `/`，
 * 用绝对路径的话资源会 404。
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});