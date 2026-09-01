import defaultModulesJson from '../../choice-prompts-optimized.json';
// 显式导入 z：auto-imports.d.ts 生成的全局 const z（typeof import('zod').z）在类型位置
// 无法当命名空间用（z.infer 报 TS2503，且该文件被 gitignore 随时重生成），不能用
import { z } from 'zod';

export const setting_field = 'choice';

export const PoolEntry = z
  .object({
    id: z.string(),
    type: z.string(),
    content: z.string().default(''),
    // v20 删除了 condition 字段：原设计是客户端变量表达式过滤，实际早已退化为发给 AI 的
    // 自由文本提示，与 rule 的"适用时机"语义完全重叠；旧存档里的 condition 键由 zod 剥离
    rule: z.string().default(''),
    pinned: z.boolean().default(false),
    weight: z.number().min(0).default(1),
    category: z.string().default(''),
  })
  // zod4 的 prefault 参数类型是输入类型：PoolEntry 的 id/type 无 default（必填），
  // 空对象不满足签名；占位值仅在输入为 undefined 的极端路径触发，正常条目不受影响
  .prefault(() => ({ id: '', type: '' }));
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
    // v20 删除了 condition 字段：条件职责并入条目库层 rule（v21 起作为写作约束，不作为选用门槛），
    // 配置层不再单独设条件；旧存档里的 condition 键由 zod 剥离
  })
  .prefault(() => ({ entry_id: '' }));
export type PoolConfigEntry = z.infer<typeof PoolConfigEntry>;

export const PoolConfig = z
  .object({
    id: z.string(),
    name: z.string(),
    entries: z.array(PoolConfigEntry),
    is_default: z.boolean().default(false),
    generation: GenerationSettings.prefault({}),
  })
  .prefault(() => ({ id: '', name: '', entries: [] }));
export type PoolConfig = z.infer<typeof PoolConfig>;

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
4. 条目规则：可选条目可能附带 [规则: xxx] 标记，该标记是对应选项的写作约束，生成该条目的选项时必须严格遵守；规则不是跳过条目的理由。
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
  .prefault(() => ({ id: '', name: '' }));
export type PromptConfig = z.infer<typeof PromptConfig>;

export const USER_INSTRUCTION_DEFAULT = `请为角色的当前处境生成恰好 {{count}} 条行动选项。

固定条目（共 {{pinned_count}} 条）：
{{pinned}}

可选条目（附带 [规则: xxx] 标记的，标记为对应选项的写作约束）：
{{pool_selected}}

生成规则：
1. 生成选项的类型、切入点、情绪态度均应有明显差异
2. 每个选项独立生成"标题"与"内容"两部分，格式约束见系统规则
3. 可选条目可能附带 [规则: xxx] 标记，该标记是对应选项的写作约束，生成时必须严格遵守；不得以规则为由跳过条目
4. 输出时严格遵守输出纯净度铁律，先输出 <thinking> 分析，再输出 <options> 选项，每个选项独占一行`;

// JSON 导入的 role 推断为 string，与 PromptModule 的字面量联合不兼容；内容受构建期 JSON 约束，
// 此处断言安全（若 JSON 里 role 拼错，运行时由 zod 解析/生成流程兜底）
export const DEFAULT_MODULES = defaultModulesJson.modules as unknown as PromptModule[];

/** 「简洁」基准内容涉及的模块 id。默认提示词（choice-prompts-optimized.json）本身就是简洁版，
 *  这里只圈出 v19 迁移简化映射涉及的四个模块，供提取单一事实源。 */
export const SIMPLE_MODULE_IDS = new Set(['core_rules', 'thinking_prompt', 'enrich_core_rules', 'enrich_thinking']);

/** 「简洁」基准内容（core_rules/thinking_prompt/enrich_core_rules/enrich_thinking）。
 *  单一事实源：从 DEFAULT_MODULES 派生，v19 老存档迁移的简化映射复用它，
 *  避免 JSON 与迁移代码两处文本漂移——JSON 改了这里自动跟随。 */
export const SIMPLE_MODULE_CONTENTS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_MODULES.filter(m => SIMPLE_MODULE_IDS.has(m.id)).map(m => [m.id, m.content]),
);

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
  .prefault(() => ({ id: '', name: '', apiurl: '', key: '', model: '' }));
export type SecondaryApi = z.infer<typeof SecondaryApi>;

/** 提示词文本迁移对：v20 删除 condition 字段后 [条件: xxx] 标记不再生成，老存档里引用该标记的
 *  提示词段落改写为 [规则] 语义；v21 进一步确立规则=纯写作约束（不再是跳过条目的触发条件），
 *  把 v20 产出的"适用时机不符则跳过"措辞收敛为约束措辞。
 *  旧串必须与前一版本的默认文本逐字一致，替换为精确子串匹配、幂等；按序应用——
 *  v19 存档先命中 v20 对（条件→skip）再命中 v21 对（skip→约束），同一遍内收敛到终态。
 *  更早版本的措辞若不同则匹配不到、保留旧文本，属可接受降级（旧指令惰性失效，不报错）。 */
export const PROMPT_TEXT_MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  // v20：DEFAULT_OPTION_RULES 第4条（条件→规则 skip 措辞，供 v21 对继续改写为约束措辞）
  [
    '4. 条件过滤：可选条目中带 [条件: xxx] 标记的，仅在当前聊天上下文符合条件描述时使用；不符合则跳过。',
    '4. 条目规则：可选条目中带 [规则: xxx] 标记的，若规则描述的适用时机与当前上下文不符则不使用该条目；选用时严格遵守规则约束。',
  ],
  // v20：USER_INSTRUCTION_DEFAULT
  ['可选条目（根据 [条件] 标记判断是否适用当前上下文）：', '可选条目（根据 [规则] 标记判断是否适用当前上下文）：'],
  [
    '3. 可选条目可能附带 [条件: xxx] 标记，仅当当前聊天上下文符合条件描述时才使用该条目',
    '3. 可选条目可能附带 [规则: xxx] 标记，仅当当前聊天上下文符合规则描述的适用时机时才使用该条目，选用时严格遵守规则约束',
  ],
  // v20：choice-prompts-optimized.json user_instruction 模块
  [
    '【固定条目】（共 {{pinned_count}} 条，本轮必须全部包含，不受下方条件过滤影响）：',
    '【固定条目】（共 {{pinned_count}} 条，本轮必须全部包含；附带 [规则: xxx] 的，遵守其写作约束）：',
  ],
  [
    '【候选条目池】（每条可能带 [条件: xxx] 标记；仅当当前上下文明确满足该条件时才可选用，否则直接跳过，不得为凑数而强行关联）：',
    '【候选条目池】（每条可能带 [规则: xxx] 标记；若规则描述的适用时机与当前上下文不符则直接跳过，不得为凑数而强行关联；选用时须遵守规则约束）：',
  ],
  [
    '3. 候选条目的条件过滤是本轮唯一的取舍依据：条件满足才使用，条件不满足或无法判断则舍弃。',
    '3. 候选条目的取舍依据是其 [规则] 标记：规则描述的适用时机与当前上下文不符或无法判断则舍弃，选用时严格遵守规则约束。',
  ],
  // v21：规则改为纯写作约束，v20 产出的 skip 措辞全部收敛（from 与上方 v20 对的 to 逐字一致）
  [
    '4. 条目规则：可选条目中带 [规则: xxx] 标记的，若规则描述的适用时机与当前上下文不符则不使用该条目；选用时严格遵守规则约束。',
    '4. 条目规则：可选条目可能附带 [规则: xxx] 标记，该标记是对应选项的写作约束，生成该条目的选项时必须严格遵守；规则不是跳过条目的理由。',
  ],
  [
    '可选条目（根据 [规则] 标记判断是否适用当前上下文）：',
    '可选条目（附带 [规则: xxx] 标记的，标记为对应选项的写作约束）：',
  ],
  [
    '3. 可选条目可能附带 [规则: xxx] 标记，仅当当前聊天上下文符合规则描述的适用时机时才使用该条目，选用时严格遵守规则约束',
    '3. 可选条目可能附带 [规则: xxx] 标记，该标记是对应选项的写作约束，生成时必须严格遵守；不得以规则为由跳过条目',
  ],
  [
    '【候选条目池】（每条可能带 [规则: xxx] 标记；若规则描述的适用时机与当前上下文不符则直接跳过，不得为凑数而强行关联；选用时须遵守规则约束）：',
    '【候选条目池】（每条可能带 [规则: xxx] 标记，该标记是对应选项的写作约束，不是跳过条目的理由）：',
  ],
  [
    '3. 候选条目的取舍依据是其 [规则] 标记：规则描述的适用时机与当前上下文不符或无法判断则舍弃，选用时严格遵守规则约束。',
    '3. 候选条目必须全部使用，每条对应一个选项；[规则: xxx] 标记是写作约束，生成时严格遵守，不得以规则为由跳过或舍弃条目。',
  ],
];

export const SCHEMA_VERSION = 22;

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
    /** @deprecated v23 起被三态/自定义条目模式吸收（book_entry_modes + book_entry_overrides），不再读写 */
    excluded_books: z.array(z.string()).prefault([]),
    /** @deprecated v23 起迁移进 book_entry_overrides（false=排除），不再读写 */
    excluded_entries: z.array(z.string()).prefault([]),
    enabled_books: z.array(z.string()).prefault([]),
    /** 已启用书的条目模式（键=书名）：off=条目全关（生成时整本不注入）、
     *  follow=条目启用（尊重酒馆条目 disable + 覆盖，默认）、force=条目全启用（无视一切关闭态）、
     *  custom=自定义（按 book_entry_overrides 逐条生效，由手动勾选任意条目进入）。 */
    book_entry_modes: z.record(z.string(), z.enum(['off', 'follow', 'force', 'custom'])).prefault({}),
    /** 自定义模式下的逐条覆盖（键=书名，内层键=uid 字符串，值=条目启用态）。仅 custom 模式生效。 */
    book_entry_overrides: z.record(z.string(), z.record(z.string(), z.boolean())).prefault({}),
  })
  .prefault({});
export type WorldInfoChatSettings = z.infer<typeof WorldInfoChatSettings>;
export type WIBookMode = 'off' | 'follow' | 'force' | 'custom';

export const UISettings = z
  .object({
    floating_enabled: z.boolean().default(true),
    enrich_enabled: z.boolean().default(true),
    enrich_count: z.string().default('4'),
    /** @deprecated 已迁移到 theme_mode，保留用于向后兼容迁移 */
    theme: z.enum(['dark', 'light']).optional(),
    /**
     * 主题模式。auto = 自动检测 ST 亮/暗，st = 完全跟随 ST 配色，dark/light = 手动覆盖；
     * dusk/sakura/celadon/honey = 独立预设主题（theme.css 各有一套完整 token 块，
     * 展示名与循环顺序见 src/core/theme-presets.ts，两处勿各自增删）。
     * 旧存档值是本枚举子集，直接兼容，无需迁移。
     */
    theme_mode: z.enum(['auto', 'st', 'dark', 'light', 'dusk', 'sakura', 'celadon', 'honey']).default('auto'),
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
    // FilterSettings 全字段带 default，{} 作为输入 parse 即得全默认对象；
    // 不能用 .default({})：zod4 的 default 参数是输出类型，要求逐字段写全
    filter_settings: FilterSettings.prefault({}),
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
