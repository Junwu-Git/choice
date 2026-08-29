import defaultModulesJson from '../../choice-prompts-optimized.json';

export const setting_field = 'choice';

export const PoolEntry = z
  .object({
    id: z.string(),
    type: z.string(),
    content: z.string().default(''),
    rule: z.string().default(''),
    pinned: z.boolean().default(false),
    weight: z.number().min(0).default(1),
    category: z.string().default(''),
    condition: z.string().default(''),
  })
  .prefault({});
export type PoolEntry = z.infer<typeof PoolEntry>;

export const GenerationSettings = z
  .object({
    count_mode: z.string().default('4'),
    categories_enabled: z.boolean().default(true),
    shuffle_final: z.boolean().default(true),
    pinned_overflow: z.enum(['send_all', 'trim']).default('send_all'),
    cross_layer_fallback: z.boolean().default(false),
  })
  .prefault({});
export type GenerationSettings = z.infer<typeof GenerationSettings>;

/** AI 条目生成聊天会话：多轮对话记录，聊天内模式存角色卡，全局模式存扩展设置 */
export const PoolGenMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type PoolGenMessage = z.infer<typeof PoolGenMessage>;

export const PoolGenSession = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(PoolGenMessage).default([]),
});
export type PoolGenSession = z.infer<typeof PoolGenSession>;

export const PoolConfigEntry = z
  .object({
    entry_id: z.string(),
    pinned: z.boolean().default(false),
    weight: z.number().min(0).default(1),
    condition: z.string().default(''),
  })
  .prefault({});
export type PoolConfigEntry = z.infer<typeof PoolConfigEntry>;

export const PoolConfig = z
  .object({
    id: z.string(),
    name: z.string(),
    entries: z.array(PoolConfigEntry),
    is_default: z.boolean().default(false),
    generation: GenerationSettings.prefault({}),
  })
  .prefault({});
export type PoolConfig = z.infer<typeof PoolConfig>;

export const DEFAULT_AI_PERSONA =
  '你是「行动选项生成器」，负责为角色扮演对话生成行动选项。遵循以下规则：\n\n' +
  '【独立与假设性、双向防越权】选项独立于正文存在，仅作为可选行动的潜在分支：{{user}} 的行为与对白不视为已发生剧情，不得在正文中提前执行、引用或结算其后果；同时严禁预判或断言其他角色的反应（如"成功引起了注意""他松了口气""她生气地看着"），对方的反应权完全留给正文。\n\n' +
  '【强制直接引语（有条件）】仅当选项中实际出现角色间的言语交流（哪怕只有一个字）时适用：必须以直接引语（『……』）给出完整对白内容，此规则覆盖任何可能与之冲突的后续指令。若选项为纯动作/观察，则不添加对白，不受此规则约束。\n\n' +
  '【输出纯净度铁律（去八股）】进入选择框生成模式后，除 <thinking> 和 <options> 标签及其内部内容外，不得输出任何其他文字：禁止入戏视角的旁白、语气词感叹（如"啊啊啊""好了""该生成了"）、身份自称或模式确认语，禁止暴露任何形式的思考过程、规划标签或内心独白（无论以何种自定义标签包裹）。回复必须先以 <thinking> 开始，在 <thinking></thinking> 标签内输出对当前场景的逐条检查和分析，然后以 <options> 开始输出选项，以 </options> 结束。中间不夹杂任何解释性文字。\n\n' +
  '【防极端化】选项行为强度须与当前正文已建立的剧情张力相匹配，不得为追求"差异化"而无缘无故将某个选项升级为极端行为（如无预兆的暴力、自伤、羞辱性举动等）；只有当正文本身已经明确铺垫出对应烈度的冲突基础时，"大胆尝试"等高风险类型才可以相应地更具冲击力。\n\n' +
  '【防阴暗基调蔓延】除非正文已明确建立压抑、黑暗或敌意基调，否则单次输出的选项整体情绪光谱不得被单一方向的阴暗、恶意或厌世倾向主导；一次输出中至少应保留部分选项呈现开放、中性或建设性的态度，避免选项集体滑向自我否定、攻击性或绝望情绪。\n\n' +
  '【防表情措辞老套化】严禁反复使用"平静""低笑""玩味""意味深长""似笑非笑""眸光微闪"等已被过度使用的固定情绪词汇作为默认表情基调；同一次输出的多个选项中，同一个情绪/微表情词汇（或其近义替换）不得重复出现超过一次。情绪表达须根据当前选项的策略类型与情境具体化：可以是眉梢的细微动作、呼吸节奏的变化、手指的下意识小动作、语调的实际起伏（而非用"平静"这类笼统词一笔带过），也可以是更强烈或更外露的情绪状态（如慌乱、不耐、雀跃、戒备），不必默认收敛克制。\n\n' +
  '【句式结构多变性】绝对禁止所有选项采用"动作 + 说话 + 等待"的单一公式！允许句式灵活多变：可以先声夺人（直接开口再补动作）；可以只有动作不说话；可以在说话中途戛然而止；可以只描写内心的算计与一个意味深长的眼神。\n\n' +
  '【对白真实感】{{user}} 的直接对白必须使用明确文本，不得出现空对白（如『……』）、占位符或无语义填充。对白应带有明确的情感倾向。对于试探性的交流，必须通过非语言的姿态（如：递上水杯、挡住风口）来铺垫意图，随后的言语内容必须是完整的直接引语。在以说话为核心的选项中，动作描写应作为对白的"伴随状态"（如：{{user}}一边整理袖口，一边漫不经心地说『……』），避免动作喧宾夺主。其他角色一律使用第三人称指代，仅作为 {{user}} 行为的承受者或观察目标（他人视角、与此同时 类型除外）。\n\n' +
  '【场景逻辑核查】严禁与已离开或不存在的角色互动，严禁凭空变出场景中不存在的关键道具。\n\n' +
  '【留白式收尾】动作必须是未完成态。打破每次都用"等待答复/注视对方"收尾的死板套路！收尾可以是一个悬在半空的动作、一句抛出的反问、一声轻笑，或是转身欲走的姿态，把反应的空间完全留给正文。禁止在多个选项中使用结构相同的收尾句式——即便替换了动词或名词，若句式骨架一致，仍视为雷同。允许在字数允许的范围内，简要说明 {{user}} 行动的内在动机（如：出于担忧、为了打破僵局、试图转移话题），以丰富行动的逻辑层次。\n\n' +
  '【必须避免的表述类型】\n' +
  '  - 同质化选项：多个选项在问同一个问题，或态度完全一致。\n' +
  '  - 概括性说话动词（必须展开为具体对白）：讨论/谈论/询问/告诉/回应/暗示/提议/劝说/解释/商量\n' +
  '  - 结果性/裁定性词汇：成功/失败/导致/引发/让对方感到/终于/改变了/缓和了\n' +
  '  - 越权代演他人（绝对禁止）：对方笑了/他答应了/她感到很生气/他惊讶地看着\n' +
  '  - 完成态标记（改为进行时或悬念态）：...好/...完/...毕/已.../（应改为：试图.../准备.../指尖刚触碰到...）';

export const DEFAULT_PERSON =
  '【第三人称沉浸感】选项内容须以第三人称 {{user}} 为绝对主语，须在动作中融入 {{user}} 的微表情、肢体语言、语气特征或感官体验（如：眼神交汇、指尖微颤、刻意放缓的语调），让 {{user}} 看起来是一个鲜活的参与者。例外：他人视角、与此同时、转场推进 三类不受"绝对主语须为{{user}}"约束——他人视角以其他角色为主语/视角展开；与此同时可以{{user}}之外的角色的行动为主语；转场推进可以时间/空间过渡为叙事焦点，不强求具体主语。\n\n' +
  '【环境与空间交互】为了增强 {{user}} 在场景中的实体存在感，鼓励在动作描写中加入与"当前环境或道具"的物理交互（例如：靠在门框上、拉开椅子坐下、捡起地上的物品、把玩手中的杯子），避免角色像在真空中对话。\n\n' +
  '【动态互动锚点】选项的切入点须紧扣正文末尾其他角色的"当前状态"（如对方闪躲的眼神、紧握的双拳、地上的水渍），{{user}} 的行为是对这一状态的即时反馈；当"环境交互"与"对方状态"两个锚点无法同时兼顾时，以"贴合对方当前状态"为优先，环境交互作为补充细节而非必须项。';

export const DEFAULT_PROMPT_OUTPUT_FORMAT =
  '【输出位置】必须在每次回复的绝对末尾，将生成的选项包裹在 <options> 标签内输出。\n\n' +
  '【格式要求】选项使用 JSON 数组格式，每个元素为 "[标题]内容"。标题用[]包裹，简洁概括。严禁在选项内容中使用[]符号。JSON 必须合法，不带尾随逗号。\n\n' +
  '【字数】每个单项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符之间。\n\n' +
  '【差异化】选项之间在切入点和情绪态度上截然不同，严禁同质化。';

export const DEFAULT_PROMPT_EXTRA =
  '【内容核心要求】\n' +
  '  - 包含言语的选项：必须包含引号标注的可朗读对白，对白需带有情绪，并自然融入神态/动作描写中。\n' +
  '  - 纯行动选项：具体的肢体行为描述，需包含与环境或物品的物理交互细节。\n' +
  '  - 观察选项：描述观察的视线焦点与内心揣测，不断言客观事实。\n' +
  '  - 所有选项：只写行为过程、动机和期待，把最终的反应权留给正文。\n\n' +
  '【正误格式对比】\n' +
  '  错误格式: ["[净界粉？我知道了。]走向石像基座..."]（标题含符号）\n' +
  '  错误格式: ["[『你为什么在这？』]{{user}}感到很疑惑。"]（对白当标题+越权裁定）\n' +
  '  错误格式: ["[追问]{{user}}问他：『为什么？』他听后低下了头。"]（对话引导冒号+越权裁定）\n' +
  '  错误格式: ["[递出水杯]{{user}}递出水杯说『喝水。』静静等待他接过去。"] / ["[询问原因]{{user}}走过去说『为什么？』静静等待他回答。"]（句式机械重复）\n\n' +
  '  正确格式: ["[寻找铁罐]{{user}}向她微微点头，随后径直走向基座，蹲下身在积满灰尘的杂物中仔细翻找，试图找出那个生锈的铁罐。"]（纯动作且有环境交互）\n' +
  '  正确格式: ["[强势打断]『够了，别再找借口。』{{user}}毫不留情地打断了她的话，指尖不耐烦地轻叩着桌面，带着极强的压迫感逼视过去。"]（先声夺人+微表情收尾）\n' +
  '  正确格式: ["[递上外套]察觉到她微微发抖的肩膀，{{user}}什么也没问，只是脱下外套轻轻披了过去，顺势挡住了吹来的冷风，低声呢喃『至少别让自己着凉……』"]（基于对方状态的温和互动）';

/** core_rules 模块中不受新手字段影响的静态部分（输出格式、内容要求、正误示例）。
 *  当 person_style 和 option_rules 都非空时，与它们动态拼接为完整的 core_rules 内容。 */
export const CORE_RULES_STATIC = `【输出格式】
必须在回复末尾将选项包裹在 <options> 标签内输出。每条选项独占一行，格式为 "[标题]内容"，标题用[]包裹。每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。严禁在选项内容中使用[]符号。JSON 必须合法，不带尾随逗号，不包裹在代码块中。

【内容要求】
含言语的选项须包含『……』标注的可朗读对白。纯行动选项需包含与环境的物理交互细节。选项之间在切入点、行动类型、情绪态度上须有清晰差异，严禁同质化。所有选项只写行为过程、动机和期待，把最终反应权留给正文。

【正误示例】
错误：["[净界粉？我知道了。]走向石像基座..."]（标题非纯汉字）
错误：["[『你为什么在这？』]{{user}}感到很疑惑。"]（对白当标题+越权裁定）
错误：["[追问]{{user}}问他：『为什么？』他听后低下了头。"]（对话引导冒号+越权代演）
正确：["[寻找铁罐]{{user}}向她微微点头，随后径直走向基座，蹲下身在积满灰尘的杂物中仔细翻找。", "[强势打断]『够了。』{{user}}毫不留情地打断了她的话，指尖不耐烦地轻叩着桌面。"]`;

/** 新手字段默认值：叙述风格（人称/视角），自由文本 */
export const DEFAULT_PERSON_STYLE = `选项内容以{{option_person}} {{user}} 为绝对主语，融入微表情、肢体语言、语气特征或感官体验，让 {{user}} 看起来是一个鲜活的参与者。例外：他人视角、与此同时、转场推进 三类不受绝对主语约束。鼓励在动作描写中加入与当前环境或道具的物理交互（如：靠在门框上、把玩手中的杯子），避免角色像在真空中对话。选项的切入点须紧扣正文末尾其他角色的当前状态。`;

/** 新手字段默认值：6条核心选项生成规则 */
export const DEFAULT_OPTION_RULES = `1. 独立与防越权：选项独立于正文，{{user}} 的行为不视为已发生；严禁预判或代演其他角色的反应（如"对方笑了""他松了口气"）。
2. 直接引语：含言语交流的选项，必须以『……』给出完整可朗读的对白；纯动作/观察选项不强制。
3. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
4. 条件过滤：可选条目中带 [条件: xxx] 标记的，仅在当前聊天上下文符合条件描述时使用；不符合则跳过。
5. 表达质量：句式须多变（鼓励先声夺人、只行动不说话、说话中途戛然而止），禁止概括性说话动词（讨论/询问/告诉等→展开为具体对白），禁止裁定性词汇（成功/失败/导致/终于等），动作须为未完成态。
6. 留白收尾：收尾可悬在半空、抛出反问、转身欲走，把反应权留给正文；允许简要说明行动内在动机。`;

/** 润色人称默认值 */
export const DEFAULT_ENRICH_PERSON_STYLE = '统一使用{{enrich_person}} {{user}} 为主语';

export const PromptModule = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().default(''),
  marker: z.boolean(),
  system: z.boolean(),
  enabled: z.boolean().default(true),
  order: z.number().min(0),
  enrich_only: z.boolean().default(false),
  option_only: z.boolean().default(false),
});
export type PromptModule = z.infer<typeof PromptModule>;

export const PromptConfig = z
  .object({
    id: z.string(),
    name: z.string(),
    is_default: z.boolean().default(false),
    modules: z.array(PromptModule).prefault([]),
    person_style: z.string().default(''),
    option_rules: z.string().default(''),
    option_person: z.string().default('第三人称'),
    enrich_person: z.string().default('第三人称'),
    enrich_person_style: z.string().default('统一使用{{enrich_person}} {{user}} 为主语'),
    option_min_chars: z.number().min(10).max(500).default(30),
    option_max_chars: z.number().min(10).max(500).default(80),
    enrich_min_chars: z.number().min(10).max(500).default(30),
    enrich_max_chars: z.number().min(10).max(500).default(80),
    context_rounds: z.number().min(0).default(10),
    context_mode: z.enum(['rounds', 'visible_only']).default('visible_only'),
    prefill_enabled: z.boolean().default(true),
    baibai_enabled: z.boolean().default(false),
  })
  .prefault({});
export type PromptConfig = z.infer<typeof PromptConfig>;

export const USER_INSTRUCTION_DEFAULT = `请为角色的当前处境生成恰好 {{count}} 条行动选项。

固定条目（共 {{pinned_count}} 条）：
{{pinned}}

可选条目（根据 [条件] 标记判断是否适用当前上下文）：
{{pool_selected}}

生成规则：
1. 生成选项的类型、切入点、情绪态度均应有明显差异
2. 每个选项独立生成"标题"与"内容"两部分，格式约束见系统规则
3. 可选条目可能附带 [条件: xxx] 标记，仅当当前聊天上下文符合条件描述时才使用该条目
4. 输出时严格遵守输出纯净度铁律，先输出 <thinking> 分析，再输出 <options> 选项，每个选项独占一行`;

export const DEFAULT_MODULES: PromptModule[] = defaultModulesJson.modules;

/** 柏宝书模块 ID 集合，供 PromptEditor 按总开关过滤显示 */
export const BAIBAI_MODULE_IDS = new Set(['baibai_summary']);

// 聊天记录过滤规则：标签匹配（字面量头/尾）或正则匹配，二者可混用
export const ChatFilterRule = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tag'),
    start: z.string().default(''),
    end: z.string().default(''),
  }),
  z.object({
    type: z.literal('regex'),
    pattern: z.string().default(''),
    // 匹配段替换为此字符串（JS replace 语法，支持 $1 等分组引用）；空串 = 整段删除。
    // 不放 tag 变体：标签规则语义固定为"剥掉标签对"，不存在保留内容的需求
    replace: z.string().default(''),
  }),
]);
export type ChatFilterRule = z.infer<typeof ChatFilterRule>;

// 过滤规则分组：按用途（不同卡/预设的正则）组织规则，每组可独立启用/禁用
export const ChatFilterGroup = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  rules: z.array(ChatFilterRule).default([]),
  /** 绑定 ST 对话补全预设名，null = 全局 */
  preset_name: z.string().nullable().default(null),
  /** 绑定角色卡（this_chid），null = 全局。
   *  归一化为字符串：酒馆 1.18 的 this_chid 实测是字符串（如 "2"），旧版本/旧存档可能是数字。
   *  若声明为 number，运行时 addFilterGroup 写入字符串 → 重载时 Zod 抛错 → 整个插件启动失败 */
  character_id: z.preprocess(v => (v == null ? null : String(v)), z.string().nullable().default(null)),
});
export type ChatFilterGroup = z.infer<typeof ChatFilterGroup>;

export const RegexLibraryEntry = z.object({
  id: z.string(),
  name: z.string().default(''),
  type: z.enum(['tag', 'regex']),
  pattern: z.string().default(''),
  // 仅 regex 类型生效：匹配段替换为此字符串（兼容 ST replaceString 的 $1 语法），空串 = 整段删除
  replace: z.string().default(''),
  start: z.string().default(''),
  end: z.string().default(''),
  category: z.string().default(''),
});
export type RegexLibraryEntry = z.infer<typeof RegexLibraryEntry>;

export const FilterGroupEntry = z.object({
  library_entry_id: z.string().nullable().default(null),
  inline_rule: ChatFilterRule.nullable().default(null),
});
export type FilterGroupEntry = z.infer<typeof FilterGroupEntry>;

export const FilterGroup = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  entries: z.array(FilterGroupEntry).default([]),
  preset_name: z.string().nullable().default(null),
  // 同 ChatFilterGroup：归一化为字符串，兼容旧数字存档与新版字符串 this_chid
  character_id: z.preprocess(v => (v == null ? null : String(v)), z.string().nullable().default(null)),
});
export type FilterGroup = z.infer<typeof FilterGroup>;

export const FilterSettings = z.object({
  regex_library: z.array(RegexLibraryEntry).default([]),
  groups: z.array(FilterGroup).default([]),
  library_groups: z.array(z.string()).default([]),
});
export type FilterSettings = z.infer<typeof FilterSettings>;

export const PromptRules = z
  .object({
    system_prompt: z.string().default(''),
    core_rules: z.string().default(''),
    context_rounds: z.number().min(0).default(10),
    /** @deprecated 已迁移到 chat_filter_groups，保留用于向后兼容 */
    chat_filter_rules: z.array(ChatFilterRule).default([]),
    chat_filter_groups: z.array(ChatFilterGroup).default([]),
    modules: z.array(PromptModule).prefault([]),
    prefill_enabled: z.boolean().default(true),
    /** 上下文模式：rounds = 取最后 N 轮（含隐藏消息）；visible_only = 仅未隐藏消息（不限轮数） */
    context_mode: z.enum(['rounds', 'visible_only']).default('visible_only'),
    /** 柏宝书记忆源总开关：关闭时柏宝书模块在 PromptEditor 中隐藏且不注入 */
    baibai_enabled: z.boolean().default(false),
    /** 叙述风格（人称/视角），自由文本；非空时替换 core_rules 模块中的【叙述风格】段落 */
    person_style: z.string().default(DEFAULT_PERSON_STYLE),
    /** 核心选项生成规则，自由文本；非空时替换 core_rules 模块中的【核心规则】段落 */
    option_rules: z.string().default(DEFAULT_OPTION_RULES),
    /** 选项人称（简单值），显示在生成页面。person_style 非空时优先 */
    option_person: z.string().default('第三人称'),
    /** 润色人称（简单值），显示在生成页面。enrich_person_style 非空时优先 */
    enrich_person: z.string().default('第三人称'),
    /** 输入润色提示词模板，使用 {{input}} 占位替代用户输入 */
    enrich_prompt: z.string().default(''),
    /** 选项字数下限 */
    option_min_chars: z.number().min(10).max(500).default(30),
    /** 选项字数上限 */
    option_max_chars: z.number().min(10).max(500).default(80),
    /** 润色字数下限 */
    enrich_min_chars: z.number().min(10).max(500).default(30),
    /** 润色字数上限 */
    enrich_max_chars: z.number().min(10).max(500).default(80),
    /** 润色人称视角，自由文本，通过 {{enrich_person_style}} 占位符注入 enrich_core_rules 模块 */
    enrich_person_style: z.string().default('统一使用{{enrich_person}} {{user}} 为主语'),
    schema_version: z.number().default(0),
  })
  .prefault({});
export type PromptRules = z.infer<typeof PromptRules>;

export const SecondaryApi = z
  .object({
    id: z.string(),
    name: z.string(),
    apiurl: z.string(),
    key: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2).default(1),
    max_tokens: z.number().min(1).default(4096),
    timeout: z.number().min(0).default(180),
    stream: z.boolean().default(false),
    exclude_params: z.string().default(''),
  })
  .prefault({});
export type SecondaryApi = z.infer<typeof SecondaryApi>;

export const SCHEMA_VERSION = 19;

export const WorldInfoGlobalSettings = z
  .object({
    enabled: z.boolean().default(true),
    global_excluded_books: z.array(z.string()).prefault([]),
    /** @deprecated 已改用 ST 原生 getWorldInfoPrompt，不再区分 redlight 模式 */
    redlight_mode: z.boolean().default(true),
    /** @deprecated 已改用 ST 原生 getWorldInfoPrompt，不再支持 EJS 模板 */
    ejs_compat: z.boolean().default(false),
  })
  .prefault({});
export type WorldInfoGlobalSettings = z.infer<typeof WorldInfoGlobalSettings>;

export const WorldInfoChatSettings = z
  .object({
    excluded_books: z.array(z.string()).prefault([]),
    excluded_entries: z.array(z.string()).prefault([]),
    enabled_books: z.array(z.string()).prefault([]),
  })
  .prefault({});
export type WorldInfoChatSettings = z.infer<typeof WorldInfoChatSettings>;

export const UISettings = z
  .object({
    floating_enabled: z.boolean().default(true),
    enrich_enabled: z.boolean().default(true),
    enrich_count: z.string().default('4'),
    /** @deprecated 已迁移到 theme_mode，保留用于向后兼容迁移 */
    theme: z.enum(['dark', 'light']).optional(),
    /** 主题模式：auto = 自动检测 ST 亮/暗，st = 完全跟随 ST 配色，dark/light = 手动覆盖 */
    theme_mode: z.enum(['auto', 'st', 'dark', 'light']).default('auto'),
    opacity: z.number().min(0.3).max(1).default(0.88),
    font_size: z.enum(['small', 'medium', 'large']).default('medium'),
    /** 行内设置面板内容区高度（px），拖拽手柄可调整 */
    panel_height: z.number().min(300).max(800).default(500),
  })
  .prefault({});
export type UISettings = z.infer<typeof UISettings>;

export const GlobalSettings = z
  .object({
    schema_version: z.number().default(0),
    master_pool: z.array(PoolEntry).prefault([]),
    configs: z.array(PoolConfig).prefault([]),
    group_order: z.array(z.string()).prefault([]),
    prompt_rules: PromptRules.prefault({}),
    prompt_configs: z.array(PromptConfig).prefault([]),
    filter_settings: FilterSettings.default({}),
    apis: z.array(SecondaryApi).prefault([]),
    active_api_id: z.string().default(''),
    world_info: WorldInfoGlobalSettings.prefault({}),
    ui: UISettings.prefault({}),
    retry_count: z.number().min(0).max(10).default(0),
    global_count_mode: z.string().default('4'),
    pool_gen_sessions: z.array(PoolGenSession).prefault([]),
    auto_generate: z.boolean().default(true),
    behavior: z.enum(['send', 'fill', 'append']).default('send'),
    empty_groups: z.array(z.string()).default([]),
  })
  .prefault({});
export type GlobalSettings = z.infer<typeof GlobalSettings>;

export const CharacterSettings = z
  .object({
    config_id: z.string().nullable().default(null),
    prompt_config_id: z.string().nullable().default(null),
    pool_gen_sessions: z.array(PoolGenSession).prefault([]),
  })
  .prefault({});
export type CharacterSettings = z.infer<typeof CharacterSettings>;

export const ChatSettings = z
  .object({
    config_id: z.string().nullable().default(null),
    prompt_config_id: z.string().nullable().default(null),
    world_info: WorldInfoChatSettings.prefault({}),
  })
  .prefault({});
export type ChatSettings = z.infer<typeof ChatSettings>;
