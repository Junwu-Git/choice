// 读取 SillyTavern 原生正则三区脚本并映射为插件正则库条目。
// @sillytavern 导入隔离于此文件（AGENTS.md：@sillytavern 导入只允许出现在 src/core/）。
import { extension_settings } from '@sillytavern/scripts/extensions';
import { characters, this_chid } from '@sillytavern/script';
import { getPresetManager } from '@sillytavern/scripts/preset-manager';
import { uuidv4 } from '@sillytavern/scripts/utils';
import type { RegexLibraryEntry } from '@/type/settings';

// ST 正则脚本存储形态的子集（驼峰字段，engine.js getScriptsByType 三区一致）。
// markdownOnly/promptOnly 为作用域标记（engine.js:348-355）：仅显示美化（markdownOnly 且未勾 promptOnly）
// 的脚本只改聊天显示、AI 始终看原文，导入为过滤规则会改废正文，导入 UI 据此禁止。
// 其余字段（trimStrings/placement/runOnEdit/substituteRegex/minDepth/maxDepth）忽略——本库只用 find/replace。
// script_name 蛇形仅兜底社区旧导出文件，ST 原生存储与官方导出均用驼峰 scriptName。
export type StRegexScript = {
  id?: string;
  scriptName?: string;
  script_name?: string;
  findRegex: string;
  replaceString?: string;
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
};

// /pattern/flags 字面量剥离，语义对齐酒馆编译行为（ST utils.js regexFromString：/body/flags → new RegExp(body, flags)）。
// 锚定 + 贪婪：仅当整串是 "/body/flags" 形态才剥离（JS 正则字面量内的裸 "/" 必须转义，故取最后一个 "/" 切分是安全的），
// 不匹配则原样返回（视为普通模式串）。flags 一律丢弃：本插件统一以 'gs' 编译，社区清理脚本的 flags 几乎全是 g/gs。
export function stripRegexLiteral(input: string): string {
  const m = input.match(/^\/(.+)\/([gimsuy]*)$/s);
  return m ? m[1] : input;
}

// ST 脚本 → 库条目。fresh uuid：库条目是独立副本，与 ST 脚本 id 解耦
// （ST 脚本 id 属于酒馆脚本库，复用为本库 id 会把"重新导入更新版"误判为重复而静默跳过——故不沿用）。
export function mapStScriptToLibraryEntry(script: StRegexScript): RegexLibraryEntry {
  return {
    id: uuidv4(),
    name: script.scriptName ?? script.script_name ?? '',
    type: 'regex',
    pattern: stripRegexLiteral(script.findRegex),
    replace: script.replaceString ?? '',
    start: '',
    end: '',
    category: '',
  };
}

// 读取 ST 对应区域的正则脚本。三区存储路径取自 engine.js getScriptsByType（勿改）：
//   global   = extension_settings.regex
//   character= characters[this_chid].data.extensions.regex_scripts
//   preset   = presetManager.readPresetExtensionField({ path: 'regex_scripts' })
// 任意一环不可用（未选角色卡 / 无预设 / ST 未注册预设管理器 / 读取异常）→ 返回 []，由调用方 UI 给空态，不抛错。
export function getStRegexScripts(zone: 'global' | 'preset' | 'character'): StRegexScript[] {
  try {
    let raw: unknown = [];
    if (zone === 'global') {
      raw = (extension_settings as any).regex ?? [];
    } else if (zone === 'character') {
      // 注意：this_chid 在酒馆里可能是字符串（实测 "2" 而非 2），不能按 number 守卫；
      // 直接作索引由 JS 转型（engine.js 同样直接 characters[this_chid]），仅排除空值（未选角色卡）。
      // characters 元素的 .data.extensions 形态 ST 类型未声明，按访问未类型化内部结构的惯例用 any 取值
      const ch = this_chid != null ? (characters as any)?.[this_chid] : undefined;
      raw = ch?.data?.extensions?.regex_scripts ?? [];
    } else {
      // getPresetManager() 无参默认按当前 main_api 取对应预设管理器（preset-manager.js:83-96），无则返回 null
      const pm = getPresetManager();
      raw = pm?.readPresetExtensionField?.({ path: 'regex_scripts' }) ?? [];
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter((s: any): s is StRegexScript => s != null && typeof s?.findRegex === 'string');
  } catch {
    return [];
  }
}

// 按角色卡 id 取名称（id 可能是字符串或数字，数组索引由 JS 转型）；取不到返回 null。
// 供组件层标注分组归属使用，避免组件直接导入 @sillytavern
export function getStCharacterName(id: string | number | null | undefined): string | null {
  if (id == null) return null;
  try {
    return (characters as any)?.[id]?.name ?? null;
  } catch {
    return null;
  }
}
