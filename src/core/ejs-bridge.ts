/**
 * 提示词模板（EJS）桥接：让 choice 的独立次级 API 调用能执行世界书条目 content 里的 <% %> JS。
 *
 * 为什么需要桥接：提示词模板插件（ST-Prompt-Template）的全部世界书处理挂在酒馆主生成
 * 事件链（WORLDINFO_ENTRIES_LOADED / CHAT_COMPLETION_SETTINGS_READY 等）上，choice 生成
 * 选项是独立次级 API 调用，不触发这些事件——插件直接调酒馆原生 getWorldInfoPrompt 拿到的
 * 是原始模板字符串而非执行后成品。插件唯一对外暴露的公共 API 是挂在 globalThis.EjsTemplate
 * 上的 evalTemplate + prepareContext（见插件 exports.ts），本桥接直接调这两个函数完成渲染，
 * 不走事件 hook、不依赖插件内部未导出的函数。
 *
 * 零侵入：choice 现有数据流 getWorldInfoPrompt → WIBuckets → buildChatHistory 全部不动，
 * 本桥接仅在 buildWI 拿到 buckets 后对 content 字符串做一层展宏 + EJS 渲染后处理。
 */
import { substituteParams } from '@sillytavern/script';

/** 提示词模板插件挂在 globalThis.EjsTemplate 上的公共执行器接口（只声明本桥接用到的两个方法）。
 *  仅作局部断言用，不写进 ambient.d.ts——避免给全局类型强加一个可能不存在（插件未装时）的字段 */
interface EjsTemplateApi {
  prepareContext: (context?: Record<string, unknown>, end?: number) => Promise<Record<string, unknown>>;
  evalTemplate: (
    code: string,
    context?: Record<string, unknown> | null,
    options?: Record<string, unknown>,
  ) => Promise<string | null>;
}

/**
 * 取提示词模板插件暴露的模板执行器。
 * 只检测 globalThis.EjsTemplate 是否存在且两个方法是函数——**不**读插件自己的 enabled 开关：
 * choice 直接调函数、不走它的事件 hook，插件 enabled 管的是它在主生成流程里的行为，与 choice
 * 无关。插件未安装 / 被酒馆禁用未加载时返回 null，调用方据此降级为只展宏。
 */
export function getEjsTemplate(): EjsTemplateApi | null {
  const api = (globalThis as unknown as { EjsTemplate?: Partial<EjsTemplateApi> }).EjsTemplate;
  if (api && typeof api.prepareContext === 'function' && typeof api.evalTemplate === 'function') {
    return api as EjsTemplateApi;
  }
  return null;
}

/**
 * 渲染世界书条目 content：先展宏 {{}} 再执行 <% %>，让动态条目（如「按好感度切换人设」的
 * `<% if variables.好感度 > 80 %>...<% } %>`）拿到成品而非原文。单条失败退回上一步文本，不
 * 影响其他条目与整体生成。开关由调用方（buildWI）判断，本函数只管渲染本身。
 *
 * ① substituteParams 展开 {{user}} 等酒馆原生宏（含其他扩展注册的自定义宏）——choice 现状
 *   连这步都没做，本桥接顺带修复该 gap；
 * ② 不含 <% 直接返回，省去 prepareContext/sandbox 开销（多数条目是纯文本）；
 * ③ 未装提示词模板插件则止步于展宏（<% %> 原样保留、不执行）——安全降级，不比现状差；
 * ④ prepareContext() 不传 world_info：getWorldInfoPrompt 拿到的是多条 entry.content 拼接的
 *   字符串，无法回溯单条条目对象传给 EJS 上下文，故零侵入——覆盖用 variables.* 的 EJS；
 *   用 world_info.* 引用条目自身的模板拿不到该字段（已知限制）。不传 end 用 EJS 默认最新楼，
 *   choice 选项针对当前场景，读当前变量快照即正确，不引入额外的楼层变量时点机制。
 */
export async function renderWorldInfoContent(content: string): Promise<string> {
  if (!content) return content;
  // ① 展宏
  let text = typeof substituteParams === 'function' ? substituteParams(content) : content;
  // ② 无 EJS 标签则无需调模板插件
  if (!text.includes('<%')) return text;
  // ③ 未装提示词模板插件则止步于展宏
  const ejs = getEjsTemplate();
  if (!ejs) return text;
  try {
    const env = await ejs.prepareContext();
    const out = await ejs.evalTemplate(text, env);
    if (typeof out === 'string') text = out;
  } catch (e) {
    console.warn('[choice] 世界书 EJS 渲染失败(退回展宏文本):', e);
  }
  return text;
}
