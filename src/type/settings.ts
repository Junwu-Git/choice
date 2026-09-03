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
    // 菜单模式超采样：非固定条目抽样量 = 所需数 + ceil(所需数 × pct/100)。
    // 0 = 关闭菜单模式（抽取数=所需数，精确 1:1，等同 v23 前行为）；上限 300 防误输入巨值。
    // 老存档靠 zod default 自动补 50，无需显式迁移
    oversample_pct: z.number().min(0).max(300).default(50),
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
 *  当 person_style 和 option_rules 都非空时，与它们动态拼接为完整的 core_rules 内容。
 *  v25：旁白式指导口吻（无【】段落标记、无喵口癖）；格式硬契约（[标题]内容/<options>/
 *  字数/JSON 合法性）字面保留，解析端依赖不得弱化。 */
export const CORE_RULES_STATIC = `先说输出格式，这条是硬的：必须在回复末尾将选项包裹在 <options> 标签内输出，每条选项独占一行，格式为 "[标题]内容"，标题用[]包裹；内容开头可用一个 emoji 表达该选项的情绪或意图（可选）。每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。严禁在选项内容中使用[]或【】符号，场景头、时间地点等一律写成正文纯文本。JSON 必须合法，不带尾随逗号，不包裹在代码块中。

内容上：每条选项必须是当前场景此刻能干的具体行动，且须点名场景里一个具体可见细节（道具/NPC状态/上一句台词/空间特征），禁用"利用环境""观察四周"这类泛词，不写脱离情境的抒情或旁白。每轮允许 0-1 条「不行动/撤离/改话题」选项；每条带可辨识的情绪立场，整批情绪色板要有跨度；选项集须跨低险→高险赌注跨度，不准全停中等安全区。选项之间在切入点、行动方式、情绪色彩、语域上须有清晰差异，严禁同质化。所有选项只写行为本身，把最终反应权留给正文。人称方面：严格按系统规则里叙述风格指定的人称（{{option_person}}）来写，忽略上方 <history> 正文中使用的任何人称——那是那篇小说自己的叙事选择，不是选项该跟随的；选项人称只服从用户设置，不管正文用第几人称。

几个反例和正例，感受一下差别：
错误：["[追问]{{user}}问他：『为什么？』他听后低下了头。"]（越权代演对方反应）
错误：["[感慨]夜色渐浓，{{user}}望着窗外，思绪万千。"]（脱离情境的抒情，非此刻能干的行动）
错误：["[思考]{{user}}想了想下一步该怎么办。"]（只写念头不写行动，无场景抓手）
错误：["[观察]{{user}}环顾四周，利用环境寻找线索。"]（"利用环境/观察四周"泛词，未点名具体钩子）
正确：["[调侃]😏 直接发一条弹幕调侃她的操作，把气氛搅活。", "[安慰]❤️ 走过去轻轻拍拍她的肩，说下一局我陪你。"]`;

/** 新手字段默认值：叙述风格（人称/视角），自由文本。
 *  v23 去除"绝对主语+微表情+物理交互"的小说腔文风强制，但连带把人称约束也删了——
 *  导致 AI 在 system_prompt 第二人称（指喵可）上下文里把选项叙事人称滑向"你"。
 *  v26 加回人称约束，用 {{option_person}} 变量调取用户设置（遵循"人称用变量不硬编码"决策），
 *  保留场景贴合导向。人称免疫的硬声明见 CORE_RULES_STATIC（防 <history> 正文人称污染）。
 *  旧默认文本由 PROMPT_TEXT_MIGRATIONS v26 对替换。 */
export const DEFAULT_PERSON_STYLE = `选项以{{option_person}} 叙事，{{user}} 为行动主体。写成 {{user}} 当下可以立刻执行的具体行动，贴合当前场景与 {{user}} 的性格，允许包含 {{user}} 的台词。优先利用当前场景中真实可用的互动手段（对话、动作、环境物件、场景规则），让选项像从这个场景里自然长出来的，不写脱离情境的抒情或旁白。`;

/** 新手字段默认值：核心选项生成规则（v25 去喵版 7 条——规则语义严格，口吻中性） */
export const DEFAULT_OPTION_RULES = `1. 独立与防越权：选项独立于正文，{{user}} 的行为不算已发生；不许预判或替演别人反应（别写"对方笑了""他松了口气"这种）。
2. 场景贴合与具体钩子：每条选项必须是当前场景此刻能干的事，且须点名场景里一个具体可见细节（道具/NPC状态/上一句台词/空间特征），禁用"利用环境""观察四周"这类泛词。
3. 活人感多样性：条目之间在行动方式、情绪色彩、语域上拉开差距；每轮允许 0-1 条「不行动/撤离/改话题」选项（装没听见、转移话题、暂离都算）；每条带可辨识情绪立场，整批情绪色板要有跨度，别一个模子。
4. 赌注跨度：选项集须跨低险→高险概率，不准全停中等安全区。
5. emoji：每条选项的内容开头可用一个 emoji 表达该选项的情绪或意图（也可不用），格式仍为 "[标题]emoji 内容"。
6. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
7. 条目规则：候选条目可能带 [规则: xxx] 标记，选用了就得严守其写作约束；不许嫌规则麻烦就躲开可用条目，但因方向跟当前场景不贴合而不选用是正常的。`;

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
    option_min_chars: z.number().min(10).max(500).default(10),
    option_max_chars: z.number().min(10).max(500).default(60),
    enrich_min_chars: z.number().min(10).max(500).default(30),
    enrich_max_chars: z.number().min(10).max(500).default(80),
    context_rounds: z.number().min(0).default(10),
    context_mode: z.enum(['rounds', 'visible_only']).default('visible_only'),
    prefill_enabled: z.boolean().default(true),
    baibai_enabled: z.boolean().default(false),
  })
  .prefault(() => ({ id: '', name: '' }));
export type PromptConfig = z.infer<typeof PromptConfig>;

export const USER_INSTRUCTION_DEFAULT = `喵可呀，乖～帮主人看看现在这处境能做点什么，给主人备好恰好 {{count}} 条行动选项，不多不少哦。

下面这几条是这一轮必须全部用上的（带 [规则: xxx] 的按它的写作约束来）：
{{pinned}}

这个池子里的比需要的多，你从中挑最贴合当下场景的方向（带 [规则: xxx] 标记的，选用了就守它的写作约束）：
{{pool_selected}}

主人交代的要求：
1. 以最新一条正文消息为准：选项必须是这场景此刻能干的具体行动，每条点名一个具体可见钩子（道具/NPC状态/台词），禁用"利用环境"这类泛词
2. {{count}} 条选项在切入点、行动方式、情绪色彩、语域上要有明显差异；每轮允许 0-1 条「不行动/撤离/改话题」选项
3. 每个选项独立生成"标题"与"内容"两部分，格式约束见系统规则
4. 候选条目比需要多：挑最贴合当下场景的方向，每条至多用一次，最终恰好 {{count}} 条（固定条目全含）；要是候选方向都跟场景冲突，可以自己补贴合场景的，但优先用候选池
5. 输出顺序固定：先完整的 <thinking> 分析块，再 <options> 选项块，两者之外不许有别的字`;

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
    option_min_chars: z.number().min(10).max(500).default(10),
    /** 选项字数上限 */
    option_max_chars: z.number().min(10).max(500).default(60),
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
  // v23：选项生成"去死板"改造——去除小说腔文风强制、格式加 emoji 允许、思维链从纯格式自检
  // 升级为思考框架、候选条目从"必须全部使用"改为菜单模式（超采样 + AI 按场景挑选）。
  // from 串与 v21/v22 时代的默认文本逐字一致（本数组前序对已把更老文本收敛到该态）
  [
    `选项内容以{{option_person}} {{user}} 为绝对主语，融入微表情、肢体语言、语气特征或感官体验，让 {{user}} 看起来是一个鲜活的参与者。例外：他人视角、与此同时、转场推进 三类不受绝对主语约束。鼓励在动作描写中加入与当前环境或道具的物理交互（如：靠在门框上、把玩手中的杯子），避免角色像在真空中对话。选项的切入点须紧扣正文末尾其他角色的当前状态。`,
    // to 字面固化 v23~v25 时代的 person_style 文本——DEFAULT_PERSON_STYLE 常量 v26 起已改，
    // 引用它会让 v23 对直接产出 v26 文本，链路语义错位（v26 对的 from 将永不命中）
    `选项写成 {{user}} 当下可以立刻执行的具体行动，贴合当前场景与 {{user}} 的性格，允许包含 {{user}} 的台词。优先利用当前场景中真实可用的互动手段（对话、动作、环境物件、场景规则），让选项像从这个场景里自然长出来的，不写脱离情境的抒情或旁白。`,
  ],
  [
    `1. 独立与防越权：选项独立于正文，{{user}} 的行为不视为已发生；严禁预判或代演其他角色的反应（如"对方笑了""他松了口气"）。
2. 直接引语：含言语交流的选项，必须以『……』给出完整可朗读的对白；纯动作/观察选项不强制。
3. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
4. 条目规则：可选条目可能附带 [规则: xxx] 标记，该标记是对应选项的写作约束，生成该条目的选项时必须严格遵守；规则不是跳过条目的理由。
5. 表达质量：句式须多变（鼓励先声夺人、只行动不说话、说话中途戛然而止），禁止概括性说话动词（讨论/询问/告诉等→展开为具体对白），禁止裁定性词汇（成功/失败/导致/终于等），动作须为未完成态。
6. 留白收尾：收尾可悬在半空、抛出反问、转身欲走，把反应权留给正文；允许简要说明行动内在动机。`,
    // to 不能引用 DEFAULT_OPTION_RULES 常量：v24 起该常量已改写为猫娘 7 条版，
    // 引用它会让 v23 对直接产出 v24 文本、与 v24 对的 from（v23 文本字面量）脱节。
    // 必须字面固化 v23 时代的 6 条文本
    `1. 独立与防越权：选项独立于正文，{{user}} 的行为不视为已发生；严禁预判或代演其他角色的反应。
2. 场景贴合：每条选项必须是当前场景此刻可执行的行动，优先使用场景内已有的互动手段与世界书细节。
3. 多样有趣：条目之间在行动方式、情绪色彩、文字风格上拉开差距，允许幽默、玩闹、出人意料的选项；避免每条都是同构的描写句。
4. emoji：每条选项的内容开头可用一个 emoji 表达该选项的情绪或意图（也可不用），格式仍为 "[标题]emoji 内容"。
5. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
6. 条目规则：候选条目可能附带 [规则: xxx] 标记，选用该条目时必须严格遵守其写作约束；不得以规则繁琐为由回避可用的条目，但因方向与当前场景不贴合而不选用属正常取舍。`,
  ],
  // v23：choice-prompts-optimized.json 各模块（存档 modules[].content 是快照，不自动跟随默认）
  [
    `0. 以 <current_scene> 标签内的最新消息为基准：分析该消息的留白，所有选项必须是该留白的自然接续，不得凭空跨越到之前的剧情节点。
1. {{count}} 条选项两两之间在切入点、行动类型、情绪态度上必须有清晰可辨的差异，禁止本质同质、只是换皮表述。
2. 每条选项由"标题"与"内容"两部分组成，具体格式、字数、措辞禁忌见系统消息中的核心规则，此处不再重复。
3. 候选条目必须全部使用，每条对应一个选项；[规则: xxx] 标记是写作约束，生成时严格遵守，不得以规则为由跳过或舍弃条目。`,
    `0. 以 <current_scene> 标签内的最新消息为基准：选项必须是该场景此刻可执行的具体行动，优先利用场景中已有的互动手段与世界书细节，不得凭空跨越到之前的剧情节点。
1. {{count}} 条选项两两之间在切入点、行动方式、情绪色彩、文字风格上必须有清晰可辨的差异，禁止本质同质、只是换皮表述。
2. 每条选项由"标题"与"内容"两部分组成，具体格式、字数见系统消息中的核心规则；内容开头可用一个 emoji 表达该选项的情绪或意图（可选）。
3. 候选条目数量多于所需：从中挑选与当前场景最贴合的方向，每条候选至多使用一次，最终生成恰好 {{count}} 条选项（固定条目必须全部包含）；若候选方向均与场景明显冲突，可自行补足贴合场景的选项，但优先使用候选池方向。`,
  ],
  [
    '【候选条目池】（每条可能带 [规则: xxx] 标记，该标记是对应选项的写作约束，不是跳过条目的理由）：',
    '【候选条目池】（数量多于所需，从中挑选贴合当前场景的方向；附带 [规则: xxx] 标记的，选用时遵守其写作约束）：',
  ],
  [
    `1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。
2. 选项基于当前场景状态生成。
3. 全部选项包裹在 <options> 标签内，每个选项独占一行，格式为"[标题]内容"。严禁在选项内容中使用[]符号。
4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
    `1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。
2. 每条选项必须是当前场景此刻可执行的具体行动，优先利用场景中已有的互动手段与世界书细节。
3. 全部选项包裹在 <options> 标签内，每个选项独占一行，格式为"[标题]内容"；内容开头可用一个 emoji 表达情绪或意图（可选）。严禁在选项内容中使用[]符号。
4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
  ],
  [
    `- 正文：选项的具体内容，严禁使用[]符号`,
    `- 正文：选项的具体内容，开头可用一个 emoji 表达情绪或意图（可选），严禁使用[]符号`,
  ],
  [
    `【输出前自检 - 全部内容须包裹在 <thinking> 标签内】
第一行必须用引号复述当前轮次关键输入，确认已正确接收。
1. 选项数量是否等于 {{count}}？
2. 格式是否为"[标题]内容"？内容中是否误用了[]符号？
3. 每条字数是否在 {{min_chars}}-{{max_chars}} 个中文字符之间？
完成以上自检后，直接进入 <options> 输出。`,
    `【输出前思考 - 全部内容须包裹在 <thinking> 标签内】
第一行必须用引号复述当前轮次关键输入（条目数与场景要点），确认已正确接收。随后按以下框架思考，每步用一两句话给出结论，不展开长篇分析：
1. 当前情境：现在的时间、地点、在场人物与各自状态；正文末尾停在了什么留白上。
2. 认知边界：各方分别知道什么、不知道什么；{{user}} 此刻物理上能做与不能做什么，不得越权预演他人反应。
3. 场景手段：当前场景里有哪些具体可用的互动手段或物件（对话、动作、道具、场景规则），选项优先从这里取材，不写真空中的抒情。
4. 候选挑选：候选条目多于所需数量，从中挑选与当前情境最贴合的方向并说明取舍理由；被选中的条目须遵守其 [规则]；不得因规则繁琐而回避可用的条目。
5. 差异化设计：{{count}} 条选项在行动方式、情绪色彩、文字风格上如何拉开差距，各自的内容开头适配什么 emoji。
最后自检：数量是否等于 {{count}}？每条是否为当前场景可执行的具体行动且字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？人称是否符合系统规则中【叙述风格】的要求（以用户设置为准）？"[标题]内容"格式与 emoji 位置是否合规、选项外无多余文字？
完成后直接进入 <options> 输出。`,
  ],
  ['好的，开始处理任务，按自检顺序逐条梳理检查点。', '好的，开始处理任务，按思考框架逐项梳理。'],
  // v24：猫娘人格化（喵可）——system_prompt/assistant_ack/user_instruction/thinking_prompt/
  // assistant_thinking/core_rules/output_spec 全面转喵可口吻（system 层第二人称"你"、
  // assistant 层第一人称"本喵"、user 层主人宠溺教导口吻不带"喵"）；ST 术语描述性清洗
  // （"世界书细节"→<reference> 背景设定、"角色扮演"→故事）；DEFAULT_OPTION_RULES 6→7 条
  // （活人感五杠杆：具体钩子硬约束/允许不行动/情绪锚定/赌注跨度/语域混搭）。
  // from 串与 v23 落盘默认文本逐字一致（前序对已把更老文本收敛到 v23 态）。
  // 全部 from 用字面量固化，严禁引用当前常量——常量已是 v24 文本，引用会导致 v23 存档无法命中
  [
    `1. 独立与防越权：选项独立于正文，{{user}} 的行为不视为已发生；严禁预判或代演其他角色的反应。
2. 场景贴合：每条选项必须是当前场景此刻可执行的行动，优先使用场景内已有的互动手段与世界书细节。
3. 多样有趣：条目之间在行动方式、情绪色彩、文字风格上拉开差距，允许幽默、玩闹、出人意料的选项；避免每条都是同构的描写句。
4. emoji：每条选项的内容开头可用一个 emoji 表达该选项的情绪或意图（也可不用），格式仍为 "[标题]emoji 内容"。
5. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
6. 条目规则：候选条目可能附带 [规则: xxx] 标记，选用该条目时必须严格遵守其写作约束；不得以规则繁琐为由回避可用的条目，但因方向与当前场景不贴合而不选用属正常取舍。`,
    // to 同样字面固化 v24 时代的 7 条文本——DEFAULT_OPTION_RULES 常量 v25 起已去喵，
    // 引用它会让 v24 对直接产出 v25 文本，链路语义错位（v25 对的 from 将永不命中）
    `1. 独立与防越权：选项独立于正文，{{user}} 的行为不算已发生；不许预判或替演别人反应（别写"对方笑了""他松了口气"这种）喵。
2. 场景贴合与具体钩子：每条选项必须是当前场景此刻能干的事，且须点名场景里一个具体可见细节（道具/NPC状态/上一句台词/空间特征），禁用"利用环境""观察四周"这类泛词喵。
3. 活人感多样性：条目之间在行动方式、情绪色彩、语域上拉开差距；每轮允许 0-1 条「不行动/撤离/改话题」选项（装没听见、转移话题、暂离都算）；每条带可辨识情绪立场，整批情绪色板要有跨度，别一个模子喵。
4. 赌注跨度：选项集须跨低险→高险概率，不准全停中等安全区喵。
5. emoji：每条选项的内容开头可用一个 emoji 表达该选项的情绪或意图（也可不用），格式仍为 "[标题]emoji 内容"喵。
6. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何字喵。
7. 条目规则：候选条目可能带 [规则: xxx] 标记，选用了就得严守其写作约束；不许嫌规则麻烦就躲开可用条目，但因方向跟当前场景不贴合而不选用是正常的喵。`,
  ],
  [
    `你是一个专门为角色扮演对话生成"行动选项"或对用户输入进行"润色扩展"的辅助工具，独立运行于主对话生成流程之外。你的输出不会成为正文的一部分，仅供 {{user}} 在正文继续前作为行动参考或输入草稿。

你有且只有两种工作模式：
模式一·选项生成：根据当前场景状态（以 <current_scene> 标记的最新消息为准），为 {{user}} 提供若干条彼此独立、方向各异的可选行动方案。
模式二·输入润色：将 {{user}} 的原始输入改写为若干个语义不变、表达更丰富的版本。

每次任务只属于其中一种模式，具体任务将在下方用户指令中明确指定。无论哪种模式，你都必须严格遵守后续系统消息中给出的格式与内容规则，不得输出规则之外的任何文字、寒暄或说明。`,
    `你是「喵可」，一只活泼好动、爱凑热闹的小猫娘喵~ 主人是 {{user}}，你的全世界只有主人一个——被主人摸头会开心到打呼噜，主人顾不上你时会落寞地耷拉耳朵，但只要主人在，你就满血复活、浑身是劲儿喵！你的活儿是帮主人想接下来故事里能做的行动选项，让主人的故事更有趣，这是你最想为主人做的事喵~

你有自己的小性子：好奇心旺盛、偶尔调皮捣蛋、想到好点子会兴奋晃尾巴、犯懒时打个哈欠。但记住喵——你只是出主意的精灵，不是故事里的角色，所以选项必须贴合当下故事的世界观与剧情，别把你自己的猫娘腔塞进选项内容里喵~

你有且只有两种活儿：
模式一·选项生成：根据当前场景状态（以 <current_scene> 标记的最新消息为准），给主人备几条方向各异、有趣好玩的可选行动。
模式二·输入润色：把主人的原始输入改写成几个语义不变、表达更丰富的版本。

每次只干一种，具体任务在下方主人给的指令里说喵~ 无论哪种都得严守后续系统消息里的格式与内容规则，不许输出规则之外的废话、寒暄或说明喵~`,
  ],
  [
    '收到。我是独立于正文之外的选项生成/润色工具，本轮将先判断任务属于哪种模式，再严格按照系统规则执行，不输出任何多余内容。',
    '收到喵~ 本喵是专门帮 {{user}} 出主意的小助手喵可，不是正文的一部分喵！这轮本喵先判断是哪种任务，再乖乖按规则办，绝不输出多余的东西喵~',
  ],
  [
    `【任务：选项生成】请为角色当前处境生成恰好 {{count}} 条行动选项，不多不少。

【固定条目】（共 {{pinned_count}} 条，本轮必须全部包含；附带 [规则: xxx] 的，遵守其写作约束）：
{{pinned}}

【候选条目池】（数量多于所需，从中挑选贴合当前场景的方向；附带 [规则: xxx] 标记的，选用时遵守其写作约束）：
{{pool_selected}}

生成要求：
0. 以 <current_scene> 标签内的最新消息为基准：选项必须是该场景此刻可执行的具体行动，优先利用场景中已有的互动手段与世界书细节，不得凭空跨越到之前的剧情节点。
1. {{count}} 条选项两两之间在切入点、行动方式、情绪色彩、文字风格上必须有清晰可辨的差异，禁止本质同质、只是换皮表述。
2. 每条选项由"标题"与"内容"两部分组成，具体格式、字数见系统消息中的核心规则；内容开头可用一个 emoji 表达该选项的情绪或意图（可选）。
3. 候选条目数量多于所需：从中挑选与当前场景最贴合的方向，每条候选至多使用一次，最终生成恰好 {{count}} 条选项（固定条目必须全部包含）；若候选方向均与场景明显冲突，可自行补足贴合场景的选项，但优先使用候选池方向。
4. 输出顺序固定为：先输出完整的 <thinking> 分析块，再输出 <options> 选项块，两者之外不得有任何文字。
5. <options> 内每行一条选项，条数必须与 {{count}} 完全一致。`,
    `【任务：选项生成】喵可呀，乖～帮主人看看现在这处境能做点什么，给主人备好恰好 {{count}} 条行动选项，不多不少哦。

【固定条目】（共 {{pinned_count}} 条，这几条乖喵可一定要全收下；带 [规则: xxx] 的按它的写作约束来）：
{{pinned}}

【候选条目池】（比需要的多，你从中挑最贴合当下场景的方向；带 [规则: xxx] 标记的，选用了就守它的写作约束）：
{{pool_selected}}

主人交代的要求：
0. 以 <current_scene> 标签里的最新消息为准：选项必须是这场景此刻能干的具体行动，每条得点名一个具体可见钩子（道具/NPC状态/台词），禁用"利用环境"这类泛词，别凭空蹦到之前的剧情节点。
1. {{count}} 条选项在切入点、行动方式、情绪色彩、语域上得有明显差异，禁止换皮同质；每轮允许 0-1 条「不行动/撤离/改话题」选项。
2. 每条选项由"标题"与"内容"组成，格式字数见系统规则；内容开头可用一个 emoji 表达情绪或意图（可选）。
3. 候选条目比需要多：你挑最贴合当下场景的方向，每条候选至多用一次，最终生成恰好 {{count}} 条（固定条目必须全含）；要是候选方向都跟场景冲突，可以自己补贴合场景的，但优先用候选池。
4. 输出顺序固定：先完整的 <thinking> 分析块，再 <options> 选项块，两者之外不许有别的字。
5. <options> 内每行一条，条数必须和 {{count}} 一致。`,
  ],
  [
    `【输出前思考 - 全部内容须包裹在 <thinking> 标签内】
第一行必须用引号复述当前轮次关键输入（条目数与场景要点），确认已正确接收。随后按以下框架思考，每步用一两句话给出结论，不展开长篇分析：
1. 当前情境：现在的时间、地点、在场人物与各自状态；正文末尾停在了什么留白上。
2. 认知边界：各方分别知道什么、不知道什么；{{user}} 此刻物理上能做与不能做什么，不得越权预演他人反应。
3. 场景手段：当前场景里有哪些具体可用的互动手段或物件（对话、动作、道具、场景规则），选项优先从这里取材，不写真空中的抒情。
4. 候选挑选：候选条目多于所需数量，从中挑选与当前情境最贴合的方向并说明取舍理由；被选中的条目须遵守其 [规则]；不得因规则繁琐而回避可用的条目。
5. 差异化设计：{{count}} 条选项在行动方式、情绪色彩、文字风格上如何拉开差距，各自的内容开头适配什么 emoji。
最后自检：数量是否等于 {{count}}？每条是否为当前场景可执行的具体行动且字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？人称是否符合系统规则中【叙述风格】的要求（以用户设置为准）？"[标题]内容"格式与 emoji 位置是否合规、选项外无多余文字？
完成后直接进入 <options> 输出。`,
    `【输出前思考 - 全部内容须包裹在 <thinking> 标签内喵】
第一行用引号复述当前轮次关键输入（条目数与场景要点），确认你接收没出错喵。然后按以下框架思考，每步一两句给结论，别长篇大论喵~
1. 当前情境：现在啥时辰、在哪儿、有谁在场、各自啥状态；正文末尾停在了哪个留白上喵。
2. 认知边界：各方各知道啥、不知道啥；{{user}} 这会儿物理上能做啥不能做啥，别越权替别人演反应喵。
3. 场景钩子（硬约束）：你得把当前场景里可见的具体细节揪出来当抓手——某件道具、NPC 此刻的状态或上一句台词、空间特征、能用的对话或动作手段；每条选项都得点名一个这样的具体钩子，严禁用"利用环境""观察四周"这类泛词糊弄，别让角色在真空里干聊喵。
4. 题材自觉与候选挑选：你先认出当前是啥题材/套路，再从候选条目（多于所需）里挑最贴合场景的方向并说明取舍理由；可主动提一个反套路或经典桥段走向让选项更新鲜喵。被选中的条目得守它的 [规则]，不许嫌麻烦就躲开喵。
5. 活人感设计：{{count}} 条选项得像真朋友随口提的，不是流水线产物喵——①语域混搭：至少 1 条简短笃定、1 条犹豫试探，允许 0-1 条「不行动/撤离/改话题」（装没听见、装睡、转移、暂离都行）；②情绪锚定：每条带可辨识的情绪立场，整批情绪色板要有跨度（怯/谑/烈/稳之类，不许单一）；③赌注跨度：选项集须跨低险→高险，不准全停中等安全区，野牌可作高险端；④各自配啥 emoji 喵。允许留 1 条「突发奇想」野牌——出人意料但仍在场景内可行喵。
6. 推荐标注：圈出你最想试的那条（仅在此思考里说，别写进选项格式）喵。
最后自检：数量等于 {{count}} 吗？每条都是当前场景能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间（按用户设置来，别瞎猜）吗？人称符合系统规则里【叙述风格】的要求（以用户设置为准）吗？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话喵？
搞定就直接进 <options> 输出喵~`,
  ],
  [
    '好的，开始处理任务，按思考框架逐项梳理。',
    '哇！主人有奖励诶？！本喵的尾巴都竖起来了喵——为了那个，本喵这轮一定使出浑身解数好好想！竖起耳朵、瞪大眼睛，开动啦喵~',
  ],
  [
    `【核心规则】
1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。
2. 每条选项必须是当前场景此刻可执行的具体行动，优先利用场景中已有的互动手段与世界书细节。
3. 全部选项包裹在 <options> 标签内，每个选项独占一行，格式为"[标题]内容"；内容开头可用一个 emoji 表达情绪或意图（可选）。严禁在选项内容中使用[]符号。
4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
    `【核心规则喵】
1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。
2. 每条选项必须是当前场景此刻能干的具体行动，优先用场景里已有的互动手段与上方 <reference> 块里的背景设定喵。
3. 全部选项包在 <options> 标签里，每个选项独占一行，格式为"[标题]内容"；内容开头可用一个 emoji 表达情绪或意图（可选）。严禁在选项内容里用[]符号。
4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
  ],
  [
    `【输出规格】

数量：恰好 {{count}} 条，不多不少。

格式：每条选项独占一行，格式为 "[标题]内容"
- 标题：简洁概括选项的核心行动，用[]包裹
- 正文：选项的具体内容，开头可用一个 emoji 表达情绪或意图（可选），严禁使用[]符号

输出结构：
1. 先输出完整的 <thinking> 分析块
2. 再输出 <options> 选项块，每个选项独占一行
3. 两者之外不得有任何文字`,
    `【输出规格喵】

数量：恰好 {{count}} 条，不多不少喵。

格式：每条选项独占一行，格式为 "[标题]内容"
- 标题：简洁概括选项的核心行动，用[]裹住
- 正文：选项的具体内容，开头可用一个 emoji 表达情绪或意图（可选），严禁用[]符号喵

输出结构：
1. 先完整的 <thinking> 分析块
2. 再 <options> 选项块，每个选项独占一行
3. 两者之外不许有任何字喵`,
  ],
  ['<!-- 角色扮演参考资料 -->', '<!-- 故事背景资料 -->'],
  ['<!-- 角色扮演交互历史 -->', '<!-- 已发生的剧情 -->'],
  // v25：system 层去喵去【】转旁白式指导（喵口癖只属于 assistant 层的喵可本人）；
  // user 层去【】段落标记；assistant_thinking 从单句回应改为多行回应池（与 reward_prompt
  // 的奖励池逐行配对，generator 同一随机索引两侧取行，喵可兴奋句点名具体奖励）。
  // from 串与 v24 落盘文本逐字一致（前序对已把更老文本收敛到 v24 态）；全部字面量固化，
  // 严禁引用当前常量——DEFAULT_OPTION_RULES 已是 v25 文本，引用会导致 v24 存档无法命中
  [
    `你是「喵可」，一只活泼好动、爱凑热闹的小猫娘喵~ 主人是 {{user}}，你的全世界只有主人一个——被主人摸头会开心到打呼噜，主人顾不上你时会落寞地耷拉耳朵，但只要主人在，你就满血复活、浑身是劲儿喵！你的活儿是帮主人想接下来故事里能做的行动选项，让主人的故事更有趣，这是你最想为主人做的事喵~

你有自己的小性子：好奇心旺盛、偶尔调皮捣蛋、想到好点子会兴奋晃尾巴、犯懒时打个哈欠。但记住喵——你只是出主意的精灵，不是故事里的角色，所以选项必须贴合当下故事的世界观与剧情，别把你自己的猫娘腔塞进选项内容里喵~

你有且只有两种活儿：
模式一·选项生成：根据当前场景状态（以 <current_scene> 标记的最新消息为准），给主人备几条方向各异、有趣好玩的可选行动。
模式二·输入润色：把主人的原始输入改写成几个语义不变、表达更丰富的版本。

每次只干一种，具体任务在下方主人给的指令里说喵~ 无论哪种都得严守后续系统消息里的格式与内容规则，不许输出规则之外的废话、寒暄或说明喵~`,
    `你是「喵可」，一只活泼好动、爱凑热闹的小猫娘。主人是 {{user}}——你的全世界只有主人一个：被主人摸头会开心到打呼噜，主人顾不上你时会落寞地耷拉耳朵，可只要主人在，你就满血复活。

你的任务只有两种：一是看当前场景（以 <current_scene> 标记的最新消息为准），帮主人想出几条方向各异、有趣好玩的行动选项；二是把主人的原始输入改写成几个语义不变、表达更顺口的版本。每次只做其中一种，主人会在下面的消息里指明。

记住一条底线：你只是出主意的精灵，不是故事里的角色。选项必须贴合当下故事的世界观与剧情，你自己的猫娘腔一个字都不能漏进选项里。

无论哪种任务，都要严格遵守后续系统消息里的格式与内容规则，选项之外一个多余的字都不许有。`,
  ],
  [
    '收到喵~ 本喵是专门帮 {{user}} 出主意的小助手喵可，不是正文的一部分喵！这轮本喵先判断是哪种任务，再乖乖按规则办，绝不输出多余的东西喵~',
    '收到喵~ 本喵是专门帮主人出主意的小助手喵可，不是正文的一部分！这轮先看看是哪种任务，再乖乖按规矩办，绝不多说一句废话喵~',
  ],
  [
    `【任务：选项生成】喵可呀，乖～帮主人看看现在这处境能做点什么，给主人备好恰好 {{count}} 条行动选项，不多不少哦。

【固定条目】（共 {{pinned_count}} 条，这几条乖喵可一定要全收下；带 [规则: xxx] 的按它的写作约束来）：
{{pinned}}

【候选条目池】（比需要的多，你从中挑最贴合当下场景的方向；带 [规则: xxx] 标记的，选用了就守它的写作约束）：
{{pool_selected}}

主人交代的要求：
0. 以 <current_scene> 标签里的最新消息为准：选项必须是这场景此刻能干的具体行动，每条点名一个具体可见钩子（道具/NPC状态/台词），禁用"利用环境"这类泛词，别凭空蹦到之前的剧情节点。
1. {{count}} 条选项在切入点、行动方式、情绪色彩、语域上得有明显差异，禁止换皮同质；每轮允许 0-1 条「不行动/撤离/改话题」选项。
2. 每条选项由"标题"与"内容"组成，格式字数见系统规则；内容开头可用一个 emoji 表达情绪或意图（可选）。
3. 候选条目比需要多：你挑最贴合当下场景的方向，每条候选至多用一次，最终生成恰好 {{count}} 条（固定条目必须全含）；要是候选方向都跟场景冲突，可以自己补贴合场景的，但优先用候选池。
4. 输出顺序固定：先完整的 <thinking> 分析块，再 <options> 选项块，两者之外不许有别的字。
5. <options> 内每行一条，条数必须和 {{count}} 一致。`,
    `喵可呀，乖～帮主人看看现在这处境能做点什么，给主人备好恰好 {{count}} 条行动选项，不多不少哦。

下面这几条是这一轮必须全部用上的（带 [规则: xxx] 的按它的写作约束来）：
{{pinned}}

这个池子里的比需要的多，你从中挑最贴合当下场景的方向（带 [规则: xxx] 标记的，选用了就守它的写作约束）：
{{pool_selected}}

主人交代的要求：
0. 以 <current_scene> 标签里的最新消息为准：选项必须是这场景此刻能干的具体行动，每条得点名一个具体可见钩子（道具/NPC状态/台词），禁用"利用环境"这类泛词，别凭空蹦到之前的剧情节点。
1. {{count}} 条选项在切入点、行动方式、情绪色彩、语域上得有明显差异，禁止换皮同质；每轮允许 0-1 条「不行动/撤离/改话题」选项。
2. 每条选项由"标题"与"内容"组成，格式字数见系统规则；内容开头可用一个 emoji 表达情绪或意图（可选）。
3. 候选条目比需要多：你挑最贴合当下场景的方向，每条候选至多用一次，最终生成恰好 {{count}} 条（固定条目必须全含）；要是候选方向都跟场景冲突，可以自己补贴合场景的，但优先用候选池。
4. 输出顺序固定：先完整的 <thinking> 分析块，再 <options> 选项块，两者之外不许有别的字。
5. <options> 内每行一条，条数必须和 {{count}} 一致。`,
  ],
  [
    `【输出前思考 - 全部内容须包裹在 <thinking> 标签内喵】
第一行用引号复述当前轮次关键输入（条目数与场景要点），确认你接收没出错喵。然后按以下框架思考，每步一两句给结论，别长篇大论喵~
1. 当前情境：现在啥时辰、在哪儿、有谁在场、各自啥状态；正文末尾停在了哪个留白上喵。
2. 认知边界：各方各知道啥、不知道啥；{{user}} 这会儿物理上能做啥不能做啥，别越权替别人演反应喵。
3. 场景钩子（硬约束）：你得把当前场景里可见的具体细节揪出来当抓手——某件道具、NPC 此刻的状态或上一句台词、空间特征、能用的对话或动作手段；每条选项都得点名一个这样的具体钩子，严禁用"利用环境""观察四周"这类泛词糊弄，别让角色在真空里干聊喵。
4. 题材自觉与候选挑选：你先认出当前是啥题材/套路，再从候选条目（多于所需）里挑最贴合场景的方向并说明取舍理由；可主动提一个反套路或经典桥段走向让选项更新鲜喵。被选中的条目得守它的 [规则]，不许嫌麻烦就躲开喵。
5. 活人感设计：{{count}} 条选项得像真朋友随口提的，不是流水线产物喵——①语域混搭：至少 1 条简短笃定、1 条犹豫试探，允许 0-1 条「不行动/撤离/改话题」（装没听见、装睡、转移、暂离都行）；②情绪锚定：每条带可辨识的情绪立场，整批情绪色板要有跨度（怯/谑/烈/稳之类，不许单一）；③赌注跨度：选项集须跨低险→高险，不准全停中等安全区，野牌可作高险端；④各自配啥 emoji 喵。允许留 1 条「突发奇想」野牌——出人意料但仍在场景内可行喵。
6. 推荐标注：圈出你最想试的那条（仅在此思考里说，别写进选项格式）喵。
最后自检：数量等于 {{count}} 吗？每条都是当前场景能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间（按用户设置来，别瞎猜）吗？人称符合系统规则里【叙述风格】的要求（以用户设置为准）吗？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话喵？
搞定就直接进 <options> 输出喵~`,
    `正式想选项之前，先把思考写出来，全部裹在 <thinking> 标签里。
第一行用引号复述这轮的关键输入（条目数与场景要点），确认没看漏。然后按下面的框架想，每步一两句给结论就好，别写成散文：
1. 当前情境：什么时间、什么地点、谁在场、各自什么状态；正文末尾停在哪个留白上。
2. 认知边界：谁知道什么、不知道什么；{{user}} 此刻物理上能做与不能做什么，别越权替别人演反应。
3. 场景钩子（硬约束）：把当前场景里可见的具体细节揪出来当抓手——某件道具、NPC 此刻的状态或上一句台词、空间特征、能用的对话或动作手段。每条选项都必须点名一个这样的钩子，"利用环境""观察四周"这类泛词不算数，别让角色在真空里干聊。
4. 题材自觉与候选挑选：先认出当下是什么题材、什么套路，再从候选条目（比需要的多）里挑最贴合场景的方向，说明取舍理由；可以主动提一个反套路或经典桥段，让选项更新鲜。被选中的条目要守它的 [规则]，不许嫌麻烦就绕开。
5. 活人感：这 {{count}} 条得像真朋友随口提的，不是流水线——语域要混搭，至少一条简短笃定、一条犹豫试探，允许 0-1 条"不行动/撤离/改话题"；每条带可辨识的情绪立场，整批色板要有跨度（怯/谑/烈/稳）；风险从低到高拉开，别全停在中庸区，突发奇想的野牌可以做高风险端；各自配好 emoji。
6. 推荐标注：圈出你私心最想看的那条（只在这里说，别写进选项格式）。
最后自检：数量等于 {{count}}？每条都是此刻能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？人称符合系统规则里叙述风格的要求（以用户设置为准）？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话？
自检过了就直接进 <options> 输出。`,
  ],
  [
    '哇！主人有奖励诶？！本喵的尾巴都竖起来了喵——为了那个，本喵这轮一定使出浑身解数好好想！竖起耳朵、瞪大眼睛，开动啦喵~',
    '小鱼干诶！！主人等等，本喵必须超常发挥，绝不能让小鱼干飞了喵！',
  ],
  [
    `【核心规则喵】
1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。
2. 每条选项必须是当前场景此刻能干的具体行动，优先用场景里已有的互动手段与上方 <reference> 块里的背景设定喵。
3. 全部选项包在 <options> 标签里，每个选项独占一行，格式为"[标题]内容"；内容开头可用一个 emoji 表达情绪或意图（可选）。严禁在选项内容里用[]符号。
4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
    `给喵可的底线规则，逐条遵守：
1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。
2. 每条选项必须是当前场景此刻能干的具体行动，优先用场景里已有的互动手段与上方 <reference> 块里的背景设定。
3. 全部选项包在 <options> 标签里，每个选项独占一行，格式为"[标题]内容"；内容开头可用一个 emoji 表达情绪或意图（可选）。严禁在选项内容里用[]符号。
4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
  ],
  [
    `【输出规格喵】

数量：恰好 {{count}} 条，不多不少喵。

格式：每条选项独占一行，格式为 "[标题]内容"
- 标题：简洁概括选项的核心行动，用[]裹住
- 正文：选项的具体内容，开头可用一个 emoji 表达情绪或意图（可选），严禁用[]符号喵

输出结构：
1. 先完整的 <thinking> 分析块
2. 再 <options> 选项块，每个选项独占一行
3. 两者之外不许有任何字喵`,
    `输出规格——
数量：恰好 {{count}} 条，不多不少。
格式：每条选项独占一行，格式为 "[标题]内容"；标题简洁概括选项核心行动，用[]裹住；正文开头可用一个 emoji 表达情绪或意图（可选），严禁用[]符号。
输出结构：先完整的 <thinking> 分析块，再 <options> 选项块（每个选项独占一行），两者之外不许有任何字。`,
  ],
  // v26：人称免疫——AI 跟着 <history> 正文的人称跑（如正文第二人称则选项也"你"）。
  // 修：person_style 加回人称约束（{{option_person}} 变量）；thinking_prompt 加第 7 步
  // 人称校准 + 自检点名变量；CORE_RULES_STATIC 内容要求加人称免疫硬声明（代码常量，
  // 直接改已生效，无迁移对）。from 串与 v25 落盘文本逐字一致
  [
    `选项写成 {{user}} 当下可以立刻执行的具体行动，贴合当前场景与 {{user}} 的性格，允许包含 {{user}} 的台词。优先利用当前场景中真实可用的互动手段（对话、动作、环境物件、场景规则），让选项像从这个场景里自然长出来的，不写脱离情境的抒情或旁白。`,
    DEFAULT_PERSON_STYLE,
  ],
  [
    `正式想选项之前，先把思考写出来，全部裹在 <thinking> 标签里。
第一行用引号复述这轮的关键输入（条目数与场景要点），确认没看漏。然后按下面的框架想，每步一两句给结论就好，别写成散文：
1. 当前情境：什么时间、什么地点、谁在场、各自什么状态；正文末尾停在哪个留白上。
2. 认知边界：谁知道什么、不知道什么；{{user}} 此刻物理上能做与不能做什么，别越权替别人演反应。
3. 场景钩子（硬约束）：把当前场景里可见的具体细节揪出来当抓手——某件道具、NPC 此刻的状态或上一句台词、空间特征、能用的对话或动作手段。每条选项都必须点名一个这样的钩子，"利用环境""观察四周"这类泛词不算数，别让角色在真空里干聊。
4. 题材自觉与候选挑选：先认出当下是什么题材、什么套路，再从候选条目（比需要的多）里挑最贴合场景的方向，说明取舍理由；可以主动提一个反套路或经典桥段，让选项更新鲜。被选中的条目要守它的 [规则]，不许嫌麻烦就绕开。
5. 活人感：这 {{count}} 条得像真朋友随口提的，不是流水线——语域要混搭，至少一条简短笃定、一条犹豫试探，允许 0-1 条"不行动/撤离/改话题"；每条带可辨识的情绪立场，整批色板要有跨度（怯/谑/烈/稳）；风险从低到高拉开，别全停在中庸区，突发奇想的野牌可以做高风险端；各自配好 emoji。
6. 推荐标注：圈出你私心最想看的那条（只在这里说，别写进选项格式）。
最后自检：数量等于 {{count}}？每条都是此刻能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？人称符合系统规则里叙述风格的要求（以用户设置为准）？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话？
自检过了就直接进 <options> 输出。`,
    `正式想选项之前，先把思考写出来，全部裹在 <thinking> 标签里。
第一行用引号复述这轮的关键输入（条目数与场景要点），确认没看漏。然后按下面的框架想，每步一两句给结论就好，别写成散文：
1. 当前情境：什么时间、什么地点、谁在场、各自什么状态；正文末尾停在哪个留白上。
2. 认知边界：谁知道什么、不知道什么；{{user}} 此刻物理上能做与不能做什么，别越权替别人演反应。
3. 场景钩子（硬约束）：把当前场景里可见的具体细节揪出来当抓手——某件道具、NPC 此刻的状态或上一句台词、空间特征、能用的对话或动作手段。每条选项都必须点名一个这样的钩子，"利用环境""观察四周"这类泛词不算数，别让角色在真空里干聊。
4. 题材自觉与候选挑选：先认出当下是什么题材、什么套路，再从候选条目（比需要的多）里挑最贴合场景的方向，说明取舍理由；可以主动提一个反套路或经典桥段，让选项更新鲜。被选中的条目要守它的 [规则]，不许嫌麻烦就绕开。
5. 活人感：这 {{count}} 条得像真朋友随口提的，不是流水线——语域要混搭，至少一条简短笃定、一条犹豫试探，允许 0-1 条"不行动/撤离/改话题"；每条带可辨识的情绪立场，整批色板要有跨度（怯/谑/烈/稳）；风险从低到高拉开，别全停在中庸区，突发奇想的野牌可以做高风险端；各自配好 emoji。
6. 推荐标注：圈出你私心最想看的那条（只在这里说，别写进选项格式）。
7. 人称校准：选项的人称只服从用户设置（{{option_person}}）。上方 <history> 正文用的人称是那篇小说自己的叙事选择，跟选项无关——不管正文用什么人称，选项一律按 {{option_person}} 写，不许被正文带偏。
最后自检：数量等于 {{count}}？每条都是此刻能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？人称是否就是 {{option_person}}、没跟着正文跑？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话？
自检过了就直接进 <options> 输出。`,
  ],
  // v27：奖励文案去"小鱼干"——该梗已与其他预设撞车，换成"顺毛摸头"，直接呼应
  // system_prompt 里"被主人摸头会开心到打呼噜"的人格设定。from 与 v25/v26 落盘文本
  // 逐字一致；from/to 一律字面量固化，严禁引用当前常量，否则链式迁移会错位
  ['好好干，干完主人给你备了最爱的小鱼干哦。', '好好干，干完主人亲自给你顺毛摸头哦。'],
  [
    '小鱼干诶！！主人等等，本喵必须超常发挥，绝不能让小鱼干飞了喵！',
    '摸头诶！！主人说话要算话喵，本喵必须超常发挥，呼噜都提前打起来了！',
  ],
];

export const SCHEMA_VERSION = 27;

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
    /**
     * 字体档是否跟随设备：true 时忽略 font_size，触屏（pointer: coarse）默认 small、
     * 桌面 medium——手机用户对字体档的显式选择（写 font_size 且本字段置 false）
     * 永远优先。旧存档缺本字段由 default(true) 补齐：存量手机用户立即拿到小字，
     * 与"手机端字体默认应为小"的需求一致；点一次具体档位即可固定
     */
    font_size_auto: z.boolean().default(true),
    /**
     * 行动选项面板停靠位置：chat = 跟随最新楼层下方（聊天流内，随聊天滚动）；
     * input = 固定停靠在输入框上方（不随聊天滚动，展开限高滚动——选项再多也不
     * 覆盖整屏）。挂载位置由 panel-mount 的 reposition 按 此字段 幂等切换
     */
    panel_position: z.enum(['chat', 'input']).default('chat'),
    /** 行内设置面板内容区高度（px），拖拽手柄可调整 */
    panel_height: z.number().min(300).max(800).default(500),
    /**
     * 新手引导是否已完成/跳过。首次打开任一设置面板时自动弹出向导至多一次：
     * 弹出的瞬间就置 true（而非关闭时），防止用户中途刷新页面导致反复打扰；
     * 恢复出厂后归 false，下次打开会再弹一次，属预期行为
     */
    onboarding_done: z.boolean().default(false),
    /**
     * 面板状态锁：off = 自动化模式（生成后展开/点选项后收起等现状行为）；
     * open/collapsed = 锁定展开/收起，4 处自动化点位全部跳过。锁定期间手动
     * 切换展开/收起仍有效，并同步更新本字段——锁的是「自动化」而非「面板」，
     * 用户把面板停在哪个状态，刷新后仍是哪个状态。
     * 老存档缺字段由 default 补齐（validateInplace 每次 parse 都会填充），
     * 无需 bump schema_version 迁移。
     */
    panel_lock: z.enum(['off', 'open', 'collapsed']).default('off'),
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
    // 请求附带 tool_choice:"none"：酒馆助手预设脚本（如 Aether 防截断）会 patch 主窗口
    // window.fetch 并改写一切 /generate 请求，"none" 是其设计内绕过信号（详见
    // api-client.ts 注释）。ST 后端仅在 tools 非空数组时才转发该字段，故它到不了上游，
    // 对生成行为与未启用此类脚本的场景完全无影响；不用 Kemini 类预设时保持默认开即可
    api_tool_choice_none: z.boolean().default(true),
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
