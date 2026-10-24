/**
 * 把 @astramai/core 打包成 Vela QuickApp 能直接引入的单文件。
 *
 * 为什么需要这一步：
 *   - core 的产物是多文件 ESM，带 `.js` 后缀的相对导入；
 *   - QuickApp 的构建链与 Vite 不同，多一层不确定性就多一个坑；
 *   - 打成一个文件后，`apps/vela/src/common/astramai-core.js` 就是全部，
 *     不会有解析不到的裸模块说明符。
 *
 * 同时产出一份 IIFE，供「无宿主 API 环境」的可移植性测试使用。
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'packages/core/dist/index.js');
const outDir = resolve(root, 'apps/vela/src/common');
const esmOut = resolve(outDir, 'astramai-core.js');
const iifeOut = resolve(root, '.probe/verify/astramai-core.iife.js');

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(iifeOut), { recursive: true });

/*
 * 手表包里把「网页专用的 AES 适配」替换成空实现。
 *
 * `packages/core/src/sync/aes-web.ts` 用的是 WebCrypto（`crypto.subtle`）
 * 加 `TextEncoder` / `TextDecoder` —— 手表上一个都没有。
 *
 * 它本身是死代码（只在函数体内引用，模块加载时不执行），
 * 但项目的约定是**产物里不许出现宿主 API 裸引用**，
 * 而且留着它在包里迟早有人误用。所以直接替换掉。
 *
 * 手表侧的 AES 在 `apps/vela/src/common/sync-aes.js`（用 @system.crypto）。
 */
const stubWebOnlyAes = {
  name: 'stub-web-only-aes',
  setup(build) {
    build.onResolve({ filter: /sync[\\/]aes-web\.js$/ }, () => ({ path: 'stub', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        '// 网页专用模块，手表包里为空实现（见 bundle-core.mjs 的说明）',
        'export async function encryptSyncPayload() {',
        "  throw new Error('encryptSyncPayload 只在网页端可用');",
        '}',
        'export async function decryptSyncPayload() {',
        "  throw new Error('decryptSyncPayload 只在网页端可用');",
        '}',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const shared = {
  entryPoints: [entry],
  bundle: true,
  platform: 'neutral',
  target: ['es2017'],
  legalComments: 'none',
  plugins: [stubWebOnlyAes],
};

// Vela 侧使用：保留 ESM，便于 `import { encodeQr } from '../common/astramai-core.js'`
const SCAN_MARKER = '/* SCAN-BELOW-ONLY */';
const esm = await build({
  ...shared,
  format: 'esm',
  outfile: esmOut,
  minify: false,
  banner: {
    js: [
      '/* 由 scripts/bundle-core.mjs 自动生成，请勿手改。源码：packages/core */',
      '/* 本文件不含任何宿主专有 API，可在 Vela 的 JS 引擎中直接运行。 */',
      SCAN_MARKER,
    ].join('\n'),
  },
});

// 可移植性测试使用：IIFE + 全局名，可以直接丢进 vm 上下文里跑
await build({
  ...shared,
  format: 'iife',
  globalName: 'AstraMaiCore',
  outfile: iifeOut,
  minify: false,
});

const esmSize = statSync(esmOut).size;

// 顺手做一次静态检查：产物里不应出现宿主 API 的裸引用。
// 只扫描 banner 之后的部分，否则注释里提到这些名字就会误报。
const fullSource = readFileSync(esmOut, 'utf8');
const markerIndex = fullSource.indexOf(SCAN_MARKER);
const source = markerIndex === -1 ? fullSource : fullSource.slice(markerIndex + SCAN_MARKER.length);
const FORBIDDEN = [
  'TextEncoder',
  'TextDecoder',
  'URLSearchParams',
  'Buffer',
  'process.',
  'require(',
  'localStorage',
  'document.',
  'window.',
  'atob(',
  'btoa(',
];
const hits = FORBIDDEN.filter((token) => source.includes(token));

console.log('已生成：');
console.log(`  Vela 用（ESM）  ${esmOut}  ${(esmSize / 1024).toFixed(1)} KB`);
console.log(`  测试用（IIFE）  ${iifeOut}`);
console.log(`  esbuild warnings: ${esm.warnings.length}`);
for (const warning of esm.warnings) console.log('    -', warning.text);

if (hits.length > 0) {
  console.log('\n⚠️  产物中出现了疑似宿主 API 引用：');
  for (const hit of hits) {
    const index = source.indexOf(hit);
    console.log(`    ${hit}  …${source.slice(Math.max(0, index - 60), index + 60).replace(/\n/g, ' ')}…`);
  }
  process.exitCode = 1;
} else {
  console.log('\n静态检查：未发现宿主 API 裸引用 ✅');
}
