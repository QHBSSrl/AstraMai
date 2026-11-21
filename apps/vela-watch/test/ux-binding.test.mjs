/**
 * `.ux` 模板绑定的静态检查。
 *
 * ── 这个测试防的是什么 ──────────────────────────────────────────────
 *
 * Vela 的模板绑定如果写错名字（`{{ ifLine }}` 而状态里叫 `diffLine`），
 * **构建不报错，运行也不报错** —— 只是那一块**渲染成空白**。
 *
 * 这类 bug 只有在真机上肉眼看才发现，而这块逻辑又没法在 Node 里跑
 * （`.ux` 依赖宿主）。所以退而求其次：**静态检查绑定的名字有没有定义**。
 *
 * ── 检查范围 ────────────────────────────────────────────────────────
 *
 * 从 `<template>` 里抽出所有 `{{ ... }}`，取其中出现的标识符，
 * 排除掉：
 *   · `$item` / `$idx` 这类循环变量
 *   · 字面量（数字、字符串）
 *   · 方法调用本身（`setKind` 之类在 `@click` 里，不在 `{{ }}` 里）
 *
 * 然后要求每个名字在 `<script>` 的 `private: { ... }` 块里出现过。
 *
 * ⚠️ 这是**启发式**检查，不是编译器。它会漏（比如条件表达式里的成员访问
 * 只查根名字），但能抓住"拼错/漏定义"这个最常见的错误。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

/** 递归收集 `.ux` 文件。 */
function collectUx(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectUx(full, out);
      continue;
    }
    if (name.endsWith('.ux')) out.push(full);
  }
  return out;
}

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'length',
  'toString',
  // JS 运算符/关键字 —— 它们会出现在表达式里，但不是状态名
  'in',
  'of',
  'new',
  'typeof',
  'void',
  'delete',
  'instanceof',
]);

/**
 * 不参与检查的路径。
 *
 * `components/InputMethod/` 是**第三方 vendored 的键盘组件** ——
 * 它的状态用的是另一套写法（几百个字段），而且**一律不许改**。
 * 拿它当标准只会制造噪音，所以直接跳过。
 */
const SKIP_PATHS = [/[\\/]components[\\/]InputMethod[\\/]/];

/** 把字符串字面量抠掉 —— `'kind--on'`、`"#e8eefc"` 不是状态名。 */
function stripStringLiterals(expression) {
  return expression.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/**
 * 抽出一个 `.ux` 文件里的绑定名。
 *
 * 只取 `{{ }}` 里的**根标识符** —— `{{ entry.title }}` 只算 `entry`。
 */
function bindingNames(template) {
  const names = new Set();

  /*
   * Vela 的 `for` 支持**内联循环变量**：`for="{{ cell in $item.cells }}"`。
   * `cell` 是在模板里就地声明的，不在 `private` 里 ——
   * 不把这类名字加进来，每个用内联变量的地方都会变成假警报。
   */
  const loopVars = new Set();
  for (const match of template.matchAll(/\bfor\s*=\s*"\{\{\s*([A-Za-z_$][\w$]*)\s+in\b/g)) {
    loopVars.add(match[1]);
  }

  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    // 先抠掉字符串字面量，否则 'kind--on' 会被当成标识符 `on`，
    // '#e8eefc' 会被当成 `e8eefc` —— 全是假警报
    const expression = stripStringLiterals(match[1]);

    // 标识符前面不能是 `$`（循环变量）、`.`（成员访问）、`\w`（名字中间）
    for (const ident of expression.matchAll(/(^|[^.$\w])([A-Za-z_$][\w$]*)/g)) {
      const name = ident[2];
      if (!name) continue;
      if (name.startsWith('$')) continue;
      if (KEYWORDS.has(name)) continue;
      if (loopVars.has(name)) continue;
      names.add(name);
    }
  }

  return names;
}

/** 找出 `private: { ... }` 块里声明的字段名。 */
function declaredFields(script) {
  const fields = new Set();

  const start = script.indexOf('private:');
  if (start < 0) return fields;

  // 从 `private: {` 开始，数大括号配对找出块的结尾
  const open = script.indexOf('{', start);
  if (open < 0) return fields;

  let depth = 0;
  let end = open;
  for (let i = open; i < script.length; i += 1) {
    const ch = script[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const block = script.slice(open + 1, end);

  // 顶层字段：行首的 `name:`（允许缩进）
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (match) fields.add(match[1]);
  }

  return fields;
}

/**
 * 组件里的 props 也算"已定义" —— `ScoreSummary` 这类组件的模板
 * 用的是 props 而不是 private。
 */
function declaredProps(script) {
  const props = new Set();
  const start = script.indexOf('props:');
  if (start < 0) return props;

  const open = script.indexOf('{', start);
  if (open < 0) return props;

  let depth = 0;
  let end = open;
  for (let i = open; i < script.length; i += 1) {
    const ch = script[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  for (const line of script.slice(open + 1, end).split('\n')) {
    const match = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (match) props.add(match[1]);
  }

  return props;
}

test('每个 .ux 的模板绑定都能在 private / props 里找到', () => {
  const problems = [];

  for (const file of collectUx(SRC)) {
    if (SKIP_PATHS.some((pattern) => pattern.test(file))) continue;
    const text = readFileSync(file, 'utf8');

    const templateMatch = text.match(/<template>([\s\S]*?)<\/template>/);
    const scriptMatch = text.match(/<script>([\s\S]*?)<\/script>/);
    if (!templateMatch || !scriptMatch) continue;

    const template = templateMatch[1];
    const script = scriptMatch[1];

    const declared = new Set([...declaredFields(script), ...declaredProps(script)]);
    // `<script>` 顶层的 const 也算（比如 `kinds` 这种常量）
    for (const constMatch of script.matchAll(/^const\s+([A-Za-z_$][\w$]*)/gm)) {
      declared.add(constMatch[1]);
    }

    for (const name of bindingNames(template)) {
      if (declared.has(name)) continue;
      problems.push(
        `${file.replace(SRC, '').replace(/\\/g, '/')} 绑定了 {{ ${name} }}，但 private / props 里没有它`,
      );
    }
  }

  assert.deepEqual(problems, [], `模板里引用了不存在的状态：\n  ${problems.join('\n  ')}`);
});
