#!/usr/bin/env node
/**
 * i18n 对账工具：代码文案键 与 i18n/en.json 的双向核对。
 *
 * 提取口径（与酒馆 i18n.js 一致）：
 *  - `t('中文')` / `t("中文")` / `$t('...')` 直接调用，键 = 字面量原文；
 *  - `t\`中文${expr}\`` 标签模板，第 N 个插值 → `${N}` 占位符（i18n.js 的 reduce 拼接口径）。
 *
 * 用法：
 *  - node tools/check-i18n.mjs                      对账报告（缺失/孤儿/静态属性提示）
 *  - node tools/check-i18n.mjs --strict             缺失或孤儿 > 0 时退出码 1（供 CI/本地门禁）
 *  - node tools/check-i18n.mjs --export out.json    导出缺失键骨架 {"键": ""}
 *  - node tools/check-i18n.mjs --merge t.json       把翻译合并进 en.json（既有键序不动，新键按拼音序追加尾部）
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const enPath = path.join(root, 'i18n', 'en.json');

const args = process.argv.slice(2);
const argValue = flag => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const strict = args.includes('--strict');
const exportPath = argValue('--export');
const mergePath = argValue('--merge');

/** 标签模板 `t\`xx${expr}yy\`` → 键：按插值出现顺序替换为 ${N}。
 *  嵌套模板（插值里再写 t\`\`）按最外层闭合，项目中不存在该写法。 */
function templateKey(raw) {
  let i = 0;
  return raw.replace(/\$\{[^}]*\}/g, () => `\${${i++}}`);
}

/** 还原模板字符串的转义序列：提取到的是原始文本，运行时键用的是 cooked 字符串——
 *  源码里的 `\n` 是两个字符，运行时是真实换行，不还原则多行键永远对不上 en.json。 */
function unescapeTemplate(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, g) => {
    switch (g) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '0':
        return '\0';
      case '\n':
        return ''; // 行尾反斜杠续行
      default:
        return g; // \\ \` \$ 等转义还原为字面字符
    }
  });
}

function extractUsedKeys() {
  const used = new Map(); // key -> 首个出现文件（报告定位用）
  const record = (k, file) => {
    if (k && !used.has(k)) used.set(k, file);
  };
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        walk(p);
      } else if (/\.(ts|vue)$/.test(f.name)) {
        const src = fs.readFileSync(p, 'utf8');
        const rel = path.relative(root, p);
        // 直接调用；(?<![\w$]) 排除 split( 等以 t 结尾的标识符伪命中
        for (const m of src.matchAll(/(?<![\w$])\$?t\(\s*'((?:[^'\\]|\\.)*)'/g)) record(m[1], rel);
        for (const m of src.matchAll(/(?<![\w$])\$?t\(\s*"((?:[^"\\]|\\.)*)"/g)) record(m[1], rel);
        // 标签模板（容忍转义与换行；先还原转义再替换占位符，与运行时 cooked 键一致）
        for (const m of src.matchAll(/(?<![\w$])\$?t`((?:[^`\\]|\\.)*)`/gs))
          record(templateKey(unescapeTemplate(m[1])), rel);
      }
    }
  };
  walk(path.join(root, 'src'));
  return used;
}

/** 模板静态中文属性（title/label/placeholder 等字面量含汉字）：未参与 i18n 的存量债务，
 *  仅统计提示、不进对账——改造成 :title="t\`...\``" 属 UI 改动，需逐处过浏览器验证。 */
function countStaticChineseAttrs() {
  let count = 0;
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        walk(p);
      } else if (f.name.endsWith('.vue')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:title|label|placeholder|text)="[^"]*[\u4e00-\u9fff][^"]*"/g)) count++;
      }
    }
  };
  walk(path.join(root, 'src', 'components'));
  return count;
}

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const used = extractUsedKeys();

if (exportPath) {
  const missing = [...used.keys()].filter(k => !(k in en)).sort((a, b) => a.localeCompare(b, 'zh'));
  fs.writeFileSync(path.resolve(exportPath), JSON.stringify(Object.fromEntries(missing.map(k => [k, '']))), 'utf8');
  console.log(`已导出 ${missing.length} 个缺失键骨架 → ${exportPath}`);
  process.exit(0);
}

if (mergePath) {
  const add = JSON.parse(fs.readFileSync(path.resolve(mergePath), 'utf8'));
  const unknown = Object.keys(add).filter(k => !used.has(k));
  if (unknown.length) {
    // 防手滑：合并进 en.json 的键必须是代码真实在用的，笔误键会永久变孤儿
    console.error(`拒绝合并：以下键在代码中未使用（可能是笔误），先修正再合并：\n${unknown.join('\n')}`);
    process.exit(1);
  }
  let added = 0;
  const newEntries = [];
  for (const [k, v] of Object.entries(add)) {
    if (!(k in en) && v) {
      newEntries.push([k, v]);
      added++;
    }
  }
  newEntries.sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  const merged = { ...en, ...Object.fromEntries(newEntries) };
  fs.writeFileSync(enPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`已合并 ${added} 条新翻译进 en.json（新键追加尾部、按拼音序）`);
  process.exit(0);
}

const missing = [...used.keys()].filter(k => !(k in en));
const orphans = Object.keys(en).filter(k => !used.has(k));
const staticAttrs = countStaticChineseAttrs();

console.log(`i18n 对账：en.json ${Object.keys(en).length} 键 | 代码提取 ${used.size} 键`);
console.log(`\n=== 缺失翻译 ${missing.length} 条（代码使用、en.json 无）===`);
for (const k of missing.sort((a, b) => a.localeCompare(b, 'zh'))) console.log(`  [${used.get(k)}] ${k}`);
console.log(`\n=== 孤儿键 ${orphans.length} 条（en.json 有、代码未用）===`);
for (const k of orphans.sort((a, b) => a.localeCompare(b, 'zh'))) console.log(`  ${k}`);
console.log(`\n=== 提示：模板静态中文属性 ${staticAttrs} 处（未参与 i18n，未计入对账）===`);
if (strict && (missing.length || orphans.length)) process.exit(1);
