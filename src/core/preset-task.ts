// 预设模式的内置任务指令：**固定内容，不读用户提示词模块**。
//
// 为什么需要它：预设模式只用酒馆预设提供叙事上下文，但选项生成有一份硬契约——
// 输出必须是 <options> 内的 JSON 数组，否则 parseOptions 解析不出任何选项；同时条目池
// 素材、防全知、难度标注这些是功能本体，不能依赖用户是否恰好保留了对应模块。
// 故此处内置一份自包含指令，与用户的模块配置彻底解耦（改预设模式语义时勿再回头引用
// prompt_rules.modules——那正是被刻意去掉的耦合）。
//
// 纯函数模块：占位符由调用方以 ctx 注入，不 import @sillytavern/*，可被 vitest 直接单测。
// ctx 用结构化类型（不 import generator 的 Ctx）——避免单测加载 generator 的运行时依赖
// （store/toastr 等），也避免与 generator 形成模块环。

/** 任务指令需要的最小上下文字段（generator.Ctx 的子集，结构兼容）。 */
export type PresetTaskCtx = {
  count: number;
  pinned: string;
  poolSelected: string;
  input: string;
  minChars: number;
  maxChars: number;
  optionPerson: string;
  enrichPerson: string;
};

/** 预设模式的任务类型。 */
export type PresetTaskKind = 'option' | 'enrich';

/** 渲染预设模式的内置任务指令（system + user 两条，追加在预设内容之后）。 */
export function renderPresetTask(kind: PresetTaskKind, ctx: PresetTaskCtx): { system: string; user: string } {
  return kind === 'enrich' ? renderEnrichTask(ctx) : renderOptionTask(ctx);
}

/** 柏宝书摘要的包装文本（单一来源）：扩展模式（baibai_summary 模块）与预设模式
 *  （buildPresetModeMessages 附加消息）共用同一份包装，防两处文案漂移。
 *  位置在 preset-task 而非 baibai-bridge：本模块是「预设/任务指令」的文案归属地，
 *  且保持零酒馆依赖可单测（摘要文本由调用方注入）。 */
export function renderBaiBaiSummaryContent(text: string): string {
  return `<baibai_summary>\n以下为记忆系统对已发生剧情的压缩摘要，记录的是已离开当前上下文窗口、不再直接可见的历史角色扮演事件。仅供你参考以保持剧情连贯，不得在回复中直接引用或复述其中内容。\n${text}\n</baibai_summary>`;
}

const fill = (template: string, ctx: PresetTaskCtx): string =>
  template
    .replaceAll('{{count}}', String(ctx.count))
    .replaceAll('{{pinned}}', ctx.pinned)
    .replaceAll('{{pool_selected}}', ctx.poolSelected)
    .replaceAll('{{input}}', ctx.input)
    .replaceAll('{{min_chars}}', String(ctx.minChars))
    .replaceAll('{{max_chars}}', String(ctx.maxChars))
    .replaceAll('{{option_person}}', ctx.optionPerson)
    .replaceAll('{{enrich_person}}', ctx.enrichPerson);

const OPTION_SYSTEM = `【本轮任务：候选生成】
以上是本次会话的背景资料与写作规则，请全部作为参考吸收；但本轮**不续写正文、不扮演角色**，只生成供挑选的下一拍候选。

候选要求：
1. 每条落在当前场景一个具体可见的细节上（道具、状态、台词、空间特征），不凭空引入新设定，也不复述已发生的事。当前场景即最后一条对话消息。
2. 候选独立于正文（本身不算已发生）；只写所选主体自身的行动与台词，不替演它落地后其他各方的反应。
3. 只用该主体此刻能知道的信息：未交代获取过程的一律视为不知道；涉及未公开真相时写成"因怀疑/听说而行动"；他人内心与意图不当事实断言（不写"他心虚了""她打算瞒住"），只写看得见的迹象（神色、动作、语气）。
4. 已知不等于熟练：新获得的力量、装备、身份按生疏处理，不写只有熟练者才掌握的细节。
5. 去主角化：各方态度按各自立场展开，不天然讨好顺从主体。
6. 需要言语的候选，话必须说出来：用『……』直接引语给出完整可朗读的台词，禁止只描述说话动作不给原话。纯动作/观察/场景演化不受此限。
7. 整批在主体、切入点、风险上拉开差距——至少一条往前推进实质一步（带来新信息、新事件或关系变化），可含 0-1 条"不行动/改话题"；开头句式要错开，禁止整批都以主体名开头。
8. 文风平实可信：不搞两极分化，避免浮夸中二的措辞与分析腔。

难度标注：每条标题用竖线追加标注，格式 "标题|档位|需求值"。
- 档位 = 保守/平衡/大胆，按该候选的风险与力度判断（推进多猛、代价多大、主体多出格），整批尽量错开。
- 需求值 = 0-100 整数，代表达成该候选所需的骰子点数下限（掷出 ≥ 需求值才算成功、点数越大越好）。行动越难、把握越低，标得越高。只认设定与剧情已明确展示过的本领，刚获得的力量按生疏从严标。整批需求值要拉开落差。拿不准就省略对应竖线段，不许乱标。

输出格式（硬约束）：全部候选输出成 <options> 内的 JSON 数组，数组用 [ ] 包裹、元素间用逗号分隔，对象形如 {"title":"标题|档位|需求值","content":"正文"}。content 是单个 JSON 字符串、不要在其中换行，可含任意字符（包括 []、【】）。只许出现 <thinking> 与 <options> 两个标签，</options> 之后一字不写。人称：严格按 {{option_person}} 写，忽略上方聊天记录正文自己的人称选择。`;

const OPTION_USER = `【任务：候选生成】根据当前场景生成恰好 {{count}} 条方向各异的下一拍候选，供 {{user}} 挑选。每条必须是当前场景里立刻能落下去的具体方向。

本轮素材：
固定条目（列表为空就跳过这段；必须全部用上，带 [规则: xxx] 的守其写作约束）：
{{pinned}}
候选条目池（多于所需，挑最贴合当下场景的方向；带 [规则: xxx] 的选用了就守）：
{{pool_selected}}

数量硬约束：恰好 {{count}} 条，固定条目全含、候选每条至多用一次；优先用候选池给的方向，素材不足或与场景冲突时再自行组织贴场景的。行动维度不封闭：条目池没列到的高频行动（求助、安抚、谈判、观察、妥协、守护等）只要贴合场景照样可以用。每条正文 {{min_chars}}-{{max_chars}} 字。先输出 <thinking> 逐条自检（场景锚点、认知边界、句式差异、数量），再输出 <options>。`;

const ENRICH_SYSTEM = `【本轮任务：输入润色】
以上是本次会话的背景资料与写作规则，请全部作为参考吸收；但本轮**不续写正文、不扮演角色**，只润色用户的输入。

润色要求：
1. 保留原文语义和语气，用不同措辞重新表达；扩展而非堆砌，生动而非空泛。
2. 原文含对白时，保留直接引语形式但内容须润色扩展（补足神态、动作、语气），严禁原样照搬；原文为叙述时，改写措辞与句式，可适度补充感官或环境细节，但不擅自新增原文没有的事件或人物行动。
3. 每个版本字数控制在 {{min_chars}}-{{max_chars}} 个中文字符之间；不足下限则补贴合语境的细节，超过上限则删减枝蔓修饰，不得用空话凑数或硬截断破坏句子完整。
4. 版本之间在描写方式、措辞风格上应有明显差异，避免全部雷同。
5. 人称只服从设置（{{enrich_person}}）；上方聊天记录正文用的人称是那篇小说自己的叙事选择，与润色无关。

输出格式（硬约束）：先输出完整的 <thinking> 分析块，再输出 <options> 选项块，每个版本独占一行、格式为 "[标题]内容"（标题用 [] 包裹，正文中严禁再使用 [] 符号）。两者之外不得有任何文字，</options> 之后一字不写。`;

const ENRICH_USER = `【任务：输入润色】请将下方【用户输入】润色扩展为 {{count}} 个版本。

【用户输入】
{{input}}

先输出 <thinking> 自检（复述原文确认接收、核对数量/格式/字数、识别对白还是叙述、校准人称），再输出 <options> 包裹的 {{count}} 个版本，每行格式为 "[标题]内容"。`;

const renderOptionTask = (ctx: PresetTaskCtx) => ({
  system: fill(OPTION_SYSTEM, ctx),
  user: fill(OPTION_USER, ctx),
});

const renderEnrichTask = (ctx: PresetTaskCtx) => ({
  system: fill(ENRICH_SYSTEM, ctx),
  user: fill(ENRICH_USER, ctx),
});
