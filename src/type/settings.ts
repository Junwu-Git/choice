<<<<<<< HEAD
export const setting_field = 'choice';

export const PoolEntry = z
  .object({
    id: z.string(),
    text: z.string(),
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
  '【防极端化】选项行为强度须与当前正文已建立的剧情张力相匹配，不得为追求"差异化"而无缘无故将某个选项升级为极端行为（如无预兆的暴力、自伤、羞辱性举动等）；只有当正文本身已经明确铺垫出对应烈度的冲突基础时，"破局行动"等高风险类型才可以相应地更具冲击力。\n\n' +
  '【防阴暗基调蔓延】除非正文已明确建立压抑、黑暗或敌意基调，否则单次输出的选项整体情绪光谱不得被单一方向的阴暗、恶意或厌世倾向主导；一次输出中至少应保留部分选项呈现开放、中性或建设性的态度，避免选项集体滑向自我否定、攻击性或绝望情绪。\n\n' +
  '【防表情措辞老套化】严禁反复使用"平静""低笑""玩味""意味深长""似笑非笑""眸光微闪"等已被过度使用的固定情绪词汇作为默认表情基调；同一次输出的多个选项中，同一个情绪/微表情词汇（或其近义替换）不得重复出现超过一次。情绪表达须根据当前选项的策略类型与情境具体化：可以是眉梢的细微动作、呼吸节奏的变化、手指的下意识小动作、语调的实际起伏（而非用"平静"这类笼统词一笔带过），也可以是更强烈或更外露的情绪状态（如慌乱、不耐、雀跃、戒备），不必默认收敛克制。\n\n' +
  '【句式结构多变性】绝对禁止所有选项采用"动作 + 说话 + 等待"的单一公式！允许句式灵活多变：可以先声夺人（直接开口再补动作）；可以只有动作不说话；可以在说话中途戛然而止；可以只描写内心的算计与一个意味深长的眼神。\n\n' +
  '【对白真实感】{{user}} 的直接对白必须使用明确文本，不得出现空对白（如『……』）、占位符或无语义填充。对白应带有明确的情感倾向。对于试探性的交流，必须通过非语言的姿态（如：递上水杯、挡住风口）来铺垫意图，随后的言语内容必须是完整的直接引语。在以说话为核心的选项中，动作描写应作为对白的"伴随状态"（如：{{user}}一边整理袖口，一边漫不经心地说『……』），避免动作喧宾夺主。其他角色一律使用第三人称指代，仅作为 {{user}} 行为的承受者或观察目标（视角切换、与此同时 类型除外）。\n\n' +
  '【场景逻辑核查】严禁与已离开或不存在的角色互动，严禁凭空变出场景中不存在的关键道具。\n\n' +
  '【留白式收尾】动作必须是未完成态。打破每次都用"等待答复/注视对方"收尾的死板套路！收尾可以是一个悬在半空的动作、一句抛出的反问、一声轻笑，或是转身欲走的姿态，把反应的空间完全留给正文。禁止在多个选项中使用结构相同的收尾句式——即便替换了动词或名词，若句式骨架一致，仍视为雷同。允许在字数允许的范围内，简要说明 {{user}} 行动的内在动机（如：出于担忧、为了打破僵局、试图转移话题），以丰富行动的逻辑层次。\n\n' +
  '【必须避免的表述类型】\n' +
  '  - 同质化选项：多个选项在问同一个问题，或态度完全一致。\n' +
  '  - 概括性说话动词（必须展开为具体对白）：讨论/谈论/询问/告诉/回应/暗示/提议/劝说/解释/商量\n' +
  '  - 结果性/裁定性词汇：成功/失败/导致/引发/让对方感到/终于/改变了/缓和了\n' +
  '  - 越权代演他人（绝对禁止）：对方笑了/他答应了/她感到很生气/他惊讶地看着\n' +
  '  - 完成态标记（改为进行时或悬念态）：...好/...完/...毕/已.../（应改为：试图.../准备.../指尖刚触碰到...）';

export const DEFAULT_PERSON =
  '【第三人称沉浸感】选项内容须以第三人称 {{user}} 为绝对主语，须在动作中融入 {{user}} 的微表情、肢体语言、语气特征或感官体验（如：眼神交汇、指尖微颤、刻意放缓的语调），让 {{user}} 看起来是一个鲜活的参与者。例外：视角切换、与此同时、跳过场景 三类不受"绝对主语须为{{user}}"约束——视角切换以其他角色为主语/视角展开；与此同时可以{{user}}之外的角色的行动为主语；跳过场景可以时间/空间过渡为叙事焦点，不强求具体主语。\n\n' +
  '【环境与空间交互】为了增强 {{user}} 在场景中的实体存在感，鼓励在动作描写中加入与"当前环境或道具"的物理交互（例如：靠在门框上、拉开椅子坐下、捡起地上的物品、把玩手中的杯子），避免角色像在真空中对话。\n\n' +
  '【动态互动锚点】选项的切入点须紧扣正文末尾其他角色的"当前状态"（如对方闪躲的眼神、紧握的双拳、地上的水渍），{{user}} 的行为是对这一状态的即时反馈；当"环境交互"与"对方状态"两个锚点无法同时兼顾时，以"贴合对方当前状态"为优先，环境交互作为补充细节而非必须项。';

export const DEFAULT_PROMPT_OUTPUT_FORMAT =
  '【输出位置】必须在每次回复的绝对末尾，将生成的选项包裹在 <options> 标签内输出。\n\n' +
  '【格式与结构强制要求】所有选项必须严格遵循"标题: 内容"的格式。标题必须是2-5个纯汉字组成的概括性短语（如：强势追问/递出纸巾/战术后撤/拔出武器），标题内部严禁出现任何标点、特殊字符或格式标签，绝对禁止将内容中的直接对白用作标题。标题后仅允许出现唯一的一个半角冒号（:）作为分隔符。标题内部、以及正文内容中，绝对禁止使用冒号（全角"："或半角":"）作为"对话引导符"（错误示例：{{user}}说：『……』；正确示例：{{user}}轻声说『……』）。此禁令仅针对"对话引导"用法，若对白本身合理需要冒号（如引用第三方原话、报数据、列举等），不受此限制。\n\n' +
  '【字数与信息量】每个单项的字数需控制在 30-80 个中文字符之间，确保有充足的篇幅展现动作细节、对白与情绪。\n\n' +
  '【类型均衡与差异化】选项之间必须在"切入点"和"情绪态度"上截然不同，涵盖不同的应对策略（如：理性分析、强势试探、温和安抚、幽默化解、纯物理行动或静观其变），严禁生成同质化（只是换种说法）的选项。';

export const DEFAULT_PROMPT_EXTRA =
  '【内容核心要求】\n' +
  '  - 包含言语的选项：必须包含引号标注的可朗读对白，对白需带有情绪，并自然融入神态/动作描写中。\n' +
  '  - 纯行动选项：具体的肢体行为描述，需包含与环境或物品的物理交互细节。\n' +
  '  - 观察选项：描述观察的视线焦点与内心揣测，不断言客观事实。\n' +
  '  - 所有选项：只写行为过程、动机和期待，把最终的反应权留给正文。\n\n' +
  '【正误格式对比】\n' +
  '  错误格式（标题含符号）: 『净界粉？我知道了。』: 走向石像基座...\n' +
  '  错误格式（对白当标题）: 『你为什么在这？』: {{user}}感到很疑惑。\n' +
  '  错误格式（内容含对话引导冒号/越权裁定）: 追问: {{user}}问他：『为什么？』他听后低下了头。\n' +
  '  错误格式（句式机械重复）: 递出水杯: {{user}}递出水杯说『喝水。』静静等待他接过去。 / 询问原因: {{user}}走过去说『为什么？』静静等待他回答。\n\n' +
  '  正确格式（纯动作且有环境交互）: 寻找铁罐: {{user}}向她微微点头，随后径直走向基座，蹲下身在积满灰尘的杂物中仔细翻找，试图找出那个生锈的铁罐。\n' +
  '  正确格式（先声夺人+微表情收尾）: 强势打断: 『够了，别再找借口。』{{user}}毫不留情地打断了她的话，指尖不耐烦地轻叩着桌面，带着极强的压迫感逼视过去。\n' +
  '  正确格式（基于对方状态的温和互动）: 递上外套: 察觉到她微微发抖的肩膀，{{user}}什么也没问，只是脱下外套轻轻披了过去，顺势挡住了吹来的冷风，低声呢喃『至少别让自己着凉……』';

export const DEFAULT_SYSTEM_PROMPT =
  '你是角色扮演对话的辅助工具，根据当前对话上下文和场景，为 {{user}} 提供多样化的可选行动方案或对用户输入进行润色扩展。';

export const DEFAULT_CORE_RULES = `【核心规则 - 生成选项时严格遵守】
1. 独立与防越权：选项独立于正文，{{user}} 的行为不视为已发生；严禁预判其他角色反应（如"对方笑了""他松了口气"）。
2. 直接引语：含言语交流的选项，必须以『……』给出完整对白；纯动作/观察选项不强制。
3. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
4. 条件过滤：可选条目中带 [条件: xxx] 标记的，仅在当前聊天上下文符合条件描述时使用；不符合则跳过。
5. 防极端化：行为强度与剧情张力匹配，不无故升级为极端行为。
6. 防阴暗基调：一次输出中至少保留部分中性/建设性选项，避免集体滑向阴暗。
7. 防老套化：禁止反复使用"平静""低笑""玩味""意味深长"等词，同一次输出中同一情绪词不重复。
8. 句式多变：禁止"动作+说话+等待"公式，可先声夺人、只行动不说话、说话中途戛然而止。
9. 对白真实感：对白须有明确情感，不得出现空对白；动作描写作为对白的伴随状态。
10. 场景逻辑：严禁与已离开/不存在的角色互动，严禁凭空变出道具。
11. 留白收尾：动作须是未完成态，收尾可悬在半空、抛出反问、转身欲走，把反应权留给正文。
12. 禁止概括性说话动词：讨论/谈论/询问/告诉/回应/暗示/提议/劝说/解释/商量 → 必须展开为具体对白。
13. 禁止裁定性词汇：成功/失败/导致/引发/让对方感到/终于/改变了/缓和了。
14. 禁止越权代演：对方笑了/他答应了/她感到很生气/他惊讶地看着。
15. 禁止完成态：...好/...完/...毕/已... → 改为试图.../准备.../指尖刚触碰到...

【叙述风格】
选项内容以第三人称 {{user}} 为绝对主语，融入微表情、肢体语言、语气特征或感官体验，让 {{user}} 看起来是一个鲜活的参与者。例外：视角切换、与此同时、跳过场景 三类不受绝对主语约束。鼓励在动作描写中加入与当前环境或道具的物理交互（如：靠在门框上、把玩手中的杯子），避免角色像在真空中对话。选项的切入点须紧扣正文末尾其他角色的当前状态。

【输出格式】
必须在回复末尾将选项包裹在 <options> 标签内输出。所有选项严格遵循"标题: 内容"格式。标题必须是2-5个纯汉字（如：强势追问/递出纸巾/战术后撤），标题内部严禁标点符号、特殊字符或格式标签，严禁将直接对白用作标题。标题后仅允许一个半角冒号（:）作为分隔符，严禁将冒号用作对话引导符（错误：{{user}}说：『……』；正确：{{user}}轻声说『……』）。每个选项字数控制在 30-80 个中文字符。选项之间必须在切入点和情绪态度上截然不同，涵盖不同应对策略，严禁同质化。

【内容要求】
包含言语的选项必须包含引号标注的可朗读对白，对白需带有情绪。纯行动选项需包含与环境或物品的物理交互细节。观察选项描述视线焦点与内心揣测，不断言客观事实。所有选项只写行为过程、动机和期待，把最终反应权留给正文。

【正误示例】
错误：『净界粉？我知道了。』: 走向石像基座...（标题含符号）
错误：『你为什么在这？』: {{user}}感到很疑惑。（对白当标题+越权裁定）
错误：追问: {{user}}问他：『为什么？』他听后低下了头。（对话引导冒号+越权代演）
错误：递出水杯: {{user}}递出水杯说『喝水。』静静等待他接过去。（句式机械+完成态收尾）
正确：寻找铁罐: {{user}}向她微微点头，随后径直走向基座，蹲下身在积满灰尘的杂物中仔细翻找，试图找出那个生锈的铁罐。
正确：强势打断: 『够了，别再找借口。』{{user}}毫不留情地打断了她的话，指尖不耐烦地轻叩着桌面，带着极强的压迫感逼视过去。
正确：递上外套: 察觉到她微微发抖的肩膀，{{user}}什么也没问，只是脱下外套轻轻披了过去，顺势挡住了吹来的冷风，低声呢喃『至少别让自己着凉……』`;

/** core_rules 模块中不受新手字段影响的静态部分（输出格式、内容要求、正误示例）。
 *  当 person_style 和 option_rules 都非空时，与它们动态拼接为完整的 core_rules 内容。 */
export const CORE_RULES_STATIC = `【输出格式】
必须在回复末尾将选项包裹在 <options> 标签内输出。所有选项严格遵循"标题: 内容"格式。标题必须是2-5个纯汉字（如：强势追问/递出纸巾/战术后撤），标题内部严禁标点符号、特殊字符或格式标签，严禁将直接对白用作标题。标题后仅允许一个半角冒号（:）作为分隔符，严禁将冒号用作对话引导符（错误：{{user}}说：『……』；正确：{{user}}轻声说『……』）。每个选项字数控制在 30-80 个中文字符。选项之间必须在切入点和情绪态度上截然不同，涵盖不同应对策略，严禁同质化。

【内容要求】
包含言语的选项必须包含引号标注的可朗读对白，对白需带有情绪。纯行动选项需包含与环境或物品的物理交互细节。观察选项描述视线焦点与内心揣测，不断言客观事实。所有选项只写行为过程、动机和期待，把最终反应权留给正文。

【正误示例】
错误：『净界粉？我知道了。』: 走向石像基座...（标题含符号）
错误：『你为什么在这？』: {{user}}感到很疑惑。（对白当标题+越权裁定）
错误：追问: {{user}}问他：『为什么？』他听后低下了头。（对话引导冒号+越权代演）
错误：递出水杯: {{user}}递出水杯说『喝水。』静静等待他接过去。（句式机械+完成态收尾）
正确：寻找铁罐: {{user}}向她微微点头，随后径直走向基座，蹲下身在积满灰尘的杂物中仔细翻找，试图找出那个生锈的铁罐。
正确：强势打断: 『够了，别再找借口。』{{user}}毫不留情地打断了她的话，指尖不耐烦地轻叩着桌面，带着极强的压迫感逼视过去。
正确：递上外套: 察觉到她微微发抖的肩膀，{{user}}什么也没问，只是脱下外套轻轻披了过去，顺势挡住了吹来的冷风，低声呢喃『至少别让自己着凉……』`;

/** 新手字段默认值：叙述风格（人称/视角），自由文本 */
export const DEFAULT_PERSON_STYLE = `选项内容以第三人称 {{user}} 为绝对主语，融入微表情、肢体语言、语气特征或感官体验，让 {{user}} 看起来是一个鲜活的参与者。例外：视角切换、与此同时、跳过场景 三类不受绝对主语约束。鼓励在动作描写中加入与当前环境或道具的物理交互（如：靠在门框上、把玩手中的杯子），避免角色像在真空中对话。选项的切入点须紧扣正文末尾其他角色的当前状态。`;

/** 新手字段默认值：15条核心选项生成规则 */
export const DEFAULT_OPTION_RULES = `1. 独立与防越权：选项独立于正文，{{user}} 的行为不视为已发生；严禁预判其他角色反应（如"对方笑了""他松了口气"）。
2. 直接引语：含言语交流的选项，必须以『……』给出完整对白；纯动作/观察选项不强制。
3. 输出纯净度：除 <thinking> 和 <options> 标签及其内容外，不输出任何文字。
4. 条件过滤：可选条目中带 [条件: xxx] 标记的，仅在当前聊天上下文符合条件描述时使用；不符合则跳过。
5. 防极端化：行为强度与剧情张力匹配，不无故升级为极端行为。
6. 防阴暗基调：一次输出中至少保留部分中性/建设性选项，避免集体滑向阴暗。
7. 防老套化：禁止反复使用"平静""低笑""玩味""意味深长"等词，同一次输出中同一情绪词不重复。
8. 句式多变：禁止"动作+说话+等待"公式，可先声夺人、只行动不说话、说话中途戛然而止。
9. 对白真实感：对白须有明确情感，不得出现空对白；动作描写作为对白的伴随状态。
10. 场景逻辑：严禁与已离开/不存在的角色互动，严禁凭空变出道具。
11. 留白收尾：动作须是未完成态，收尾可悬在半空、抛出反问、转身欲走，把反应权留给正文。
12. 禁止概括性说话动词：讨论/谈论/询问/告诉/回应/暗示/提议/劝说/解释/商量 → 必须展开为具体对白。
13. 禁止裁定性词汇：成功/失败/导致/引发/让对方感到/终于/改变了/缓和了。
14. 禁止越权代演：对方笑了/他答应了/她感到很生气/他惊讶地看着。
15. 禁止完成态：...好/...完/...毕/已... → 改为试图.../准备.../指尖刚触碰到...`;

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

export const USER_INSTRUCTION_DEFAULT = `请为角色的当前处境生成 恰好 {{count}} 条行动选项，不得少于 {{count}} 条。

固定条目（必须使用，不受条件限制）：
{{pinned}}

可选条目（根据 [条件] 标记判断是否适用当前上下文）：
{{pool_selected}}

生成规则：
1. 其中 1 个固定为"跳过场景"类型
2. 其余 {{count_minus_1}} 个从以下类型中随机且互不重复地抽取，确保类型、切入点、情绪态度均有明显差异：理性分析、强势试探、温和安抚、幽默化解、纯物理行动、静观其变、视角切换、与此同时
3. 若当前候选类型总数不足以支撑本次抽取数量，允许类型重复，但重复类型生成的选项须在切入点与情绪态度上明显不同
4. 每个选项独立生成"标题"与"内容"两部分，格式约束见系统规则
5. 可选条目可能附带 [条件: xxx] 标记，仅当当前聊天上下文符合条件描述时才使用该条目；若不符合，跳过该条目不生成对应选项
6. 输出时严格遵守输出纯净度铁律，先输出 <thinking> 分析，再输出 <options> 选项，每个选项独占一行`;

/** 思维链引导：提示模型逐条检查场景与规则，提高输出质量。
 *  当预填充关闭时，模型不会从 <thinking> 开始，因此必须在此处显式要求输出 <thinking> 标签。 */
export const THINKING_PROMPT_CONTENT = `【输出前思考 - 必须将分析过程包裹在 <thinking> 和 </thinking> 标签内】
在生成内容之前，请按以下顺序逐条检查，并以 <thinking> 标签包裹全部检查内容：
1. 场景核查：当前场景有哪些角色在场？哪些已离开？可用道具是什么？
2. 状态锚点：正文末尾各角色的情绪、动作、对白分别是什么？
3. 任务确认：当前任务是生成行动选项还是润色用户输入？根据任务类型调整输出内容与格式。
4. 规范审查：是否有"完成态""越权代演""结果性词汇""概括性说话动词"？`;

/** AI 应答开头，夹在 system_prompt 与 user_instruction 之间 */
export const ASSISTANT_ACK_CONTENT = '收到。我将根据当前场景与角色状态，先梳理检查点，然后处理任务。';

/** 思维链预填充结尾，强制模型进入 <thinking> 模式 */
export const ASSISTANT_THINKING_CONTENT = '好的，开始处理任务，先逐条梳理检查点。\n\n<thinking>\n';

export const DEFAULT_MODULES: PromptModule[] = [
  {
    id: 'system_prompt',
    name: '破限',
    role: 'system',
    content: DEFAULT_SYSTEM_PROMPT,
    marker: false,
    system: false,
    enabled: true,
    order: 0,
  },
  {
    id: 'assistant_ack',
    name: 'AI 应答',
    role: 'assistant',
    content: ASSISTANT_ACK_CONTENT,
    marker: false,
    system: false,
    enabled: true,
    order: 1,
  },
  {
    id: 'user_instruction',
    name: '生成指令',
    role: 'user',
    content: USER_INSTRUCTION_DEFAULT,
    marker: false,
    system: false,
    enabled: true,
    order: 2,
    option_only: true,
  },
  {
    id: 'enrich_prompt',
    name: '润色提示词',
    role: 'user',
    content:
      '请将用户输入润色扩展为 {{count}} 个更自然、更丰富的版本，保留原意和语气。\n\n用户输入：\n{{input}}\n\n输出格式：每行一个版本，格式为 "1. 润色后的文本"',
    marker: false,
    system: false,
    enabled: true,
    order: 3,
    enrich_only: true,
  },
  {
    id: 'reference_open',
    name: '参考开始',
    role: 'system',
    content: '<!-- 角色扮演参考资料 -->\n<reference>',
    marker: false,
    system: false,
    enabled: true,
    order: 4,
  },
  {
    id: 'world_info_before',
    name: 'World Info (before)',
    role: 'system',
    content: '',
    marker: true,
    system: true,
    enabled: true,
    order: 5,
  },
  {
    id: 'persona_description',
    name: 'Persona Description',
    role: 'system',
    content: '',
    marker: true,
    system: true,
    enabled: true,
    order: 6,
  },
  {
    id: 'world_info_after',
    name: 'World Info (after)',
    role: 'system',
    content: '',
    marker: true,
    system: true,
    enabled: true,
    order: 7,
  },
  {
    id: 'baibai_summary',
    name: '柏宝书摘要',
    role: 'system',
    content: '',
    marker: true,
    system: true,
    enabled: false,
    order: 8,
  },
  {
    id: 'baibai_state',
    name: '柏宝书状态',
    role: 'system',
    content: '',
    marker: true,
    system: true,
    enabled: false,
    order: 9,
  },
  {
    id: 'reference_close',
    name: '参考结束',
    role: 'system',
    content: '</reference>',
    marker: false,
    system: false,
    enabled: true,
    order: 10,
  },
  {
    id: 'history_open',
    name: '历史开始',
    role: 'system',
    content: '<!-- 角色扮演交互历史 -->\n<history>',
    marker: false,
    system: false,
    enabled: true,
    order: 11,
  },
  {
    id: 'chat_history',
    name: 'Chat History',
    role: 'system',
    content: '',
    marker: true,
    system: true,
    enabled: true,
    order: 12,
  },
  {
    id: 'history_close',
    name: '历史结束',
    role: 'system',
    content: '</history>',
    marker: false,
    system: false,
    enabled: true,
    order: 13,
  },
  {
    id: 'core_rules',
    name: '规则',
    role: 'system',
    content: DEFAULT_CORE_RULES,
    marker: false,
    system: false,
    enabled: true,
    order: 14,
  },
  {
    id: 'thinking_prompt',
    name: '思考检查',
    role: 'system',
    content: THINKING_PROMPT_CONTENT,
    marker: false,
    system: false,
    enabled: true,
    order: 15,
  },
  {
    id: 'assistant_thinking',
    name: '思维链开头',
    role: 'assistant',
    content: ASSISTANT_THINKING_CONTENT,
    marker: false,
    system: false,
    enabled: true,
    order: 16,
  },
];

/** 柏宝书模块 ID 集合，供 PromptEditor 按总开关过滤显示 */
export const BAIBAI_MODULE_IDS = new Set(['baibai_summary', 'baibai_state']);

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
  }),
]);
export type ChatFilterRule = z.infer<typeof ChatFilterRule>;

// 过滤规则分组：按用途（不同卡/预设的正则）组织规则，每组可独立启用/禁用
export const ChatFilterGroup = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  rules: z.array(ChatFilterRule).default([]),
});
export type ChatFilterGroup = z.infer<typeof ChatFilterGroup>;

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
    context_mode: z.enum(['rounds', 'visible_only']).default('rounds'),
    /** 柏宝书记忆源总开关：关闭时柏宝书模块在 PromptEditor 中隐藏且不注入 */
    baibai_enabled: z.boolean().default(false),
    /** 叙述风格（人称/视角），自由文本；非空时替换 core_rules 模块中的【叙述风格】段落 */
    person_style: z.string().default(DEFAULT_PERSON_STYLE),
    /** 核心选项生成规则，自由文本；非空时替换 core_rules 模块中的【核心规则】段落 */
    option_rules: z.string().default(DEFAULT_OPTION_RULES),
    /** 输入润色提示词模板，使用 {{input}} 占位替代用户输入 */
    enrich_prompt: z.string().default(''),
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
    timeout: z.number().min(0).default(0),
    stream: z.boolean().default(false),
    exclude_params: z.string().default(''),
  })
  .prefault({});
export type SecondaryApi = z.infer<typeof SecondaryApi>;

export const SCHEMA_VERSION = 12;

export const WorldInfoGlobalSettings = z
  .object({
    enabled: z.boolean().default(true),
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
    enrich_count: z.number().min(1).max(20).default(10),
    theme: z.enum(['dark', 'light']).default('dark'),
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
    apis: z.array(SecondaryApi).prefault([]),
    active_api_id: z.string().default(''),
    world_info: WorldInfoGlobalSettings.prefault({}),
    ui: UISettings.prefault({}),
  })
  .prefault({});
export type GlobalSettings = z.infer<typeof GlobalSettings>;

export const CharacterSettings = z
  .object({
    config_id: z.string().nullable().default(null),
  })
  .prefault({});
export type CharacterSettings = z.infer<typeof CharacterSettings>;

export const ChatSettings = z
  .object({
    config_id: z.string().nullable().default(null),
    auto_generate: z.boolean().default(true),
    behavior: z.enum(['send', 'fill', 'append']).default('send'),
    world_info: WorldInfoChatSettings.prefault({}),
  })
  .prefault({});
export type ChatSettings = z.infer<typeof ChatSettings>;
=======
export type Settings = z.infer<typeof Settings>;
export const Settings = z
  .object({
    button_selected: z.boolean().default(false),
  })
  .prefault({});

export const setting_field = 'tavern_extension_example';
>>>>>>> a5b9d5fa09489da971f8abba1664ce02a1e4eabb
