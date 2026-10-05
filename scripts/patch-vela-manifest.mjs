/**
 * 补齐 manifest 的 permissions。
 *
 * 背景：InputMethod 组件里调用了 `device.getInfo()`，因此 toolchain 会要求声明
 * `system.device` 这个 feature。但官方 manifest 文档的权限表写明：
 *
 *   | hapjs.permission.DEVICE_INFO | system.device | getSerial / getDeviceId |
 *
 * 也就是说 **光声明 feature 不够，还要声明对应的 permission**。
 * 我们之前只有 features 没有 permissions，导致 `device.getInfo` 在运行时不可用——
 * 这正是模拟器上那个 `TypeError: not a function` 的最可能来源。
 */

import { readFileSync, writeFileSync } from 'node:fs';

const file = 'apps/vela/src/manifest.json';
const manifest = JSON.parse(readFileSync(file, 'utf8'));

const REQUIRED_PERMISSIONS = ['hapjs.permission.DEVICE_INFO'];

manifest.permissions = REQUIRED_PERMISSIONS.map((name) => ({ name }));

// 让 features 与 permissions 的对应关系一目了然
const featureOrder = [
  'system.fetch',
  'system.storage',
  'system.file',
  'system.vibrator',
  'system.router',
  'system.device',
];
const present = new Set(manifest.features.map((f) => f.name));
manifest.features = featureOrder.filter((n) => present.has(n)).map((name) => ({ name }));

writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log('features   :', manifest.features.map((f) => f.name).join(', '));
console.log('permissions:', manifest.permissions.map((p) => p.name).join(', '));
