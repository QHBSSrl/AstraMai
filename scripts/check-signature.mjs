#!/usr/bin/env node
/**
 * 查 APK / RPK 的签名证书指纹。
 *
 * ── 为什么需要这个 ──────────────────────────────────────────────────
 *
 * 有三件事都依赖「这个包到底是谁签的」：
 *
 *   1. **Google 开发者验证** —— 注册应用时要填 SHA-256 证书指纹
 *   2. **小米 interconnect** —— 手表快应用和手机 App 必须同一张证书，
 *      不一样就直接拒绝连接，而且不给有用的错误
 *   3. **升级安装** —— 同包名换签名，Android 会拒绝安装
 *
 * 而我们的构建**有可能悄悄回退到 debug keystore**：
 * `build.gradle.kts` 找不到 `key.properties` 时就是 debug 签名，
 * 打出来的包看着正常，装上去才发现连不上。
 *
 * 所以发布前跑一遍这个脚本。
 *
 * 用法：
 *   node scripts/check-signature.mjs                     # 查默认的 release 包
 *   node scripts/check-signature.mjs <apk 或 rpk 路径>    # 查指定的包
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * 我们认的那张证书的 SHA-256。
 *
 * 来源：`apps/vela/sign/certificate.pem`，转成 `astramai-release.p12`。
 * 和 `apps/flutter/android/key.properties` 里注释的那串是同一个。
 */
const EXPECTED =
  'E3:3D:D6:7A:BC:8C:6E:A9:C3:CE:61:BB:7C:55:0B:41:'
  + 'D7:F9:FC:2F:C4:59:0E:2D:51:15:47:E1:4E:13:60:9E';

const SDK = process.env.ANDROID_HOME ?? 'D:\\AndroidSDK';
const APKSIGNER = resolve(SDK, 'build-tools', '35.0.0', 'apksigner.bat');

const target =
  process.argv[2]
  ?? resolve(root, 'apps/flutter/build/app/outputs/flutter-apk/app-release.apk');

if (!existsSync(target)) {
  console.error(`  ❌ 找不到：${target}`);
  console.error('     先构建，或者把路径当参数传进来。');
  process.exit(1);
}

/** 统一成「大写、冒号分隔」的形态，方便肉眼比对。 */
function normalize(hex) {
  const clean = hex.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return (clean.match(/../g) ?? []).join(':');
}

console.log(`  包：${target}`);
console.log('');

// apksigner 只认 APK；RPK 得用别的办法，这里先只处理 APK
if (target.toLowerCase().endsWith('.apk')) {
  let out = '';
  try {
    /*
     * ⚠️ Windows 上不能直接 spawn `.bat` —— Node 会报 EINVAL。
     * 必须走 shell，让 cmd 去解释那个批处理。
     */
    out = execFileSync(APKSIGNER, ['verify', '--print-certs', target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
  } catch (error) {
    // apksigner 校验失败时会把原因写在 stdout / stderr 里，别丢
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    console.error('  ❌ apksigner 执行失败');
    if (detail) console.error(`     ${detail}`);
    else console.error(`     ${error.message}`);
    process.exit(1);
  }

  const match = /SHA-256 digest:\s*([0-9a-f]+)/i.exec(out);
  if (!match) {
    console.error('  ❌ 没读到 SHA-256 指纹（是不是没签名？）');
    process.exit(1);
  }

  const actual = normalize(match[1]);
  console.log(`  SHA-256   ${actual}`);
  console.log('');

  if (actual === EXPECTED) {
    console.log('  ✅ 和我们那张证书一致，可以发。');
  } else {
    console.log('  ❌ 不一致！');
    console.log(`     期望：${EXPECTED}`);
    console.log('');
    console.log('     常见原因：本机没有 apps/flutter/android/key.properties，');
    console.log('     Gradle 回退到了 debug keystore。');
    console.log('     这样的包装上去 interconnect 连不通，Google 验证也过不了。');
    process.exit(2);
  }
} else {
  // RPK 是 zip，证书在签名块里；用 keytool 或 unzip 取都可以，
  // 这里只做个提示，不猜格式。
  console.log('  ⚠️ 目前只支持 .apk。RPK 的签名请用 aiot 工具链或');
  console.log('     apps/vela/sign/certificate.pem 直接比对。');
  const pem = resolve(root, 'apps/vela/sign/certificate.pem');
  if (existsSync(pem)) {
    console.log(`     PEM 在：${pem}`);
    console.log('     openssl x509 -in 该文件 -noout -fingerprint -sha256');
  }
}
