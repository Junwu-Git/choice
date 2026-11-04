/**
 * 知识边界的提示词与合并请求文本层（纯函数，零酒馆运行时依赖，可被 vitest 直接覆盖）。
 *
 * 为什么拆出 RULES_BODY / ENTRY_SCHEMA：独立分析与「合并进选项生成」必须共用同一套
 * 三态口径与字段定义，否则两条链路的判定标准会漂移——注入给生成侧的结论就会和
 * 分析侧自己的表打架。两个模式只各写自己的输出框架。
 *
 * 为什么合并模式用紧凑版而不是整段复制：生成请求里已经有 knowledge_boundary 模块
 * （非全知约束）与 thinking_prompt（思考框架），再把整套分析规则抄一遍只会让输出契约
 * 被淹没，模型顾着读规则反而写不好候选。合并版只补三态与字段这两处生成侧没有的信息。
 */

import { MAX_STORED_ENTRIES, parseKnowledgeResponse, type KnowledgePatch } from '@/core/knowledge-report';

/** 判定口径（两个模式共用）：从「判定对象」到「增量维护规则」结束。 */
export const KNOWLEDGE_RULES_BODY = `【判定对象】
只判定 {{user}} 一个人的知识状态。其他角色知道什么不在此列（他们各自的秘密属于 {{user}} 的「未知」）。

【三态口径（从严认定）】
- known（已知）：设定或剧情明确写过 {{user}} 通过看、听、读或被当面告知获取了该信息。必须能指出获取的具体来源。
- uncertain（存疑）：{{user}} 只接触到传闻、怀疑、可见迹象（神色、动作、语气、前后矛盾的言行），但没有得到确认。
- unknown（未知）：没有交代获取过程的一律算不知道——包括背景设定资料里只有读者能看到的内容（他人的秘密计划、远方发生的事、尚未公开的真相、角色未告知的身份）。他人的内心想法与打算对 {{user}} 永远是 unknown，除非已被当面说出。

【获取方式 source（每条必填）】
- witnessed：亲眼看见、亲耳听见现场发生的事。
- heard：从他人处听说、转述或传闻。
- read：读过文字材料（信件、档案、告示、书籍）。
- inferred：由可见迹象推断，没有直接来源。
- none：没有获取过程（只用于 unknown）。
known 必须有 witnessed / heard / read / inferred 之一；unknown 只能是 none。不确定时按「没有交代获取过程」处理，归 unknown。

【依据 basis 与时间 event_time】
basis 用一句话写清这条判定倚赖什么，必须点到具体的人、事、物——让只看到这一行的人也知道这条在讲什么：
- known：写清出处，哪段剧情里谁当面说了什么、主角亲眼看到或听到什么、哪份背景资料交代了什么；
- uncertain：写清有哪些迹象或传闻，以及缺的那一环（没人证实、当事人没承认、只看到神色）；
- unknown：写清材料到哪里为止——哪段背景、哪条设定或哪段剧情没有写、谁没有被告知、正文只字未提的是什么，例如「背景设定只交代她是这家女主人，她的过往与私生活没有任何剧情提及」「主角从未被告知他的姓名，剧情里也没有他自报家门的段落」。
不要写「未交代获取过程」「只有读者可见」这类类别标签：它没说这条讲的是什么，写了等于没写，还会挤占注入预算。也不要写「第 N 条消息」这类位置编号——你看到的内容里没有编号，写了也是编造。
event_time 是可选字段，默认留空字符串。只有当正文或场景元数据里**明确写出**了时间（日期、时刻、纪年、「第二天」「三日后」这类相对时点）时才照抄原话；没有就留空，不要推断、不要用聊天记录的时间戳或现实时间顶替。多数条目留空是正常的。
**不要写时段描述**：「某日上午」「下午」「傍晚」「夜里」「那天早上」这类既不是时间点、也没法和其他条目比先后。正文只说了「第二天」却没给具体日期就写「第二天」；连这个都没有就留空。写了「某日」「某天」等于承认你不知道是哪天——那不如留空。

【关联对象 subject（每条必填）】
写这条信息**针对谁/哪样东西**，用故事里已有的称呼，不要自创：
- 角色：写角色正名（「富川立花」「武」），不写「她」「那位太太」这类指代；
- 地点/物品/组织：写具体名称（「城北仓库」「富川家」「那封信」）；
- 世界规则、时代背景、通用设定：写「世界设定」。
同一批条目里，指同一个对象的写法必须一致——不要在一条里写「立花」、另一条写「富川立花」，
否则面板里会分裂成两个对象。已有表里每条都带 [对象=…]，照抄其中已有的写法即可。

【status 与 source 的连带关系】
status 为 unknown 时**必然**没有获取过程，source 只能是 none，不需要另行判断；
反过来，source 为 none 的条目一定是 unknown。不要出现「未知 + 目击」这种组合。

【历史摘要的用法】
消息里可能出现 <memory_summary> 块，它是更早剧情的压缩摘要（已离开当前可见窗口的部分）。
- 它只用于核对「已有条目」的出处与前后因果，不得当作新剧情材料去新增条目或改写状态。
- 摘要里没有写到的获取过程，同样按「未交代」处理，不得据此判定 known。
- 摘要与可见对话冲突时，以可见对话为准。

【重要性档位 importance（每条必填）】
只按一句话判据：**这条要是没出现在注入里，模型会不会写出越界或全知的候选？**
- high（高）：漏了会直接翻车——主角不知道的秘密与身份、他人刻意隐瞒的意图、尚未公开的真相。
- normal（中）：漏了会让语气、分寸或立场失准，但不破底线。**新条目默认给 normal。**
- low（低）：背景常识、背景设定或当前场景已经明写的内容（常态身份、既有关系、环境陈设）。
档位只决定预算紧张时先保谁、先丢谁，不代表剧情上重不重要。多数条目应是 normal，
high 只在确实会引发越界时使用；把大半张表标成 high 等于没有分档。

【档位会随剧情变化，必须定期重估】
已有表里每条都带 [档位=高/中/低]。每次分析都要顺便问一句「它现在还这么要紧吗」，
需要改档就输出该条目（只给 id 与 importance 即可，其余字段省略会保留旧值）：
- 秘密已被当众说破、伏笔已揭晓、冲突已解决 → 降档，通常直接降到 low；
- 相关场景已翻篇、该角色已离场、这条已不再约束下一批候选 → 降档；
- 原本只是背景的内容因新剧情变成敏感点 → 升档。
不要因为「当初标过 high」就维持不变：档位是当下判断，不是历史记录。
仅重复确认档位不算变化，不要输出。

【覆盖范围】
尽量覆盖这几类：人物身份与关系、秘密与未公开真相、事件进展与因果、地点与人物动向、关键物品与能力来历。只列对「下一步能做什么」有影响的信息，不列天气、环境这类无约束力的细节。一条信息一项，不要把多个事实塞进同一条。
重要程度从高到低固定为：未知 > 存疑 > 已知。补齐也按这个顺序：先把未知一项项查漏补齐——{{user}} 不知道而下一步行动可能踩到的信息，漏一条就可能写出全知候选；未知补齐后再补存疑，最后才轮到已知。条数放不下时反向舍弃：先丢已知，再丢存疑，未知留到最后。
**不为常态信息建条**：背景设定或当前场景已经明写的身份、关系、环境陈设，生成侧本来就看得到，单独建条只会挤占预算——除非它正是某条未知/存疑的参照面（如「她是这家女主人」是「她另有图谋」这一未知项的落点）。未知与存疑不受此限，照常记录。

【增量维护规则（重要）】
消息里可能附有「已有知识边界表」，每条都带 id。它记录的是你此前判定过、且可能来自当前上下文之外的早期剧情：
- 已有条目除非新剧情**明确推翻**，否则一律保持不变，不要因为看不到原始出处就删除或改成 unknown。
- 同义或同一件事必须沿用已有条目的 id，不得新建重复条目；若已有条目换了说法，把旧说法放进 aliases。
- aliases 只放「同一件事的另一种叫法」（简称、旧称、他人称呼）。同一段剧情里并列的不同事实是不同条目，不得互相塞进别名：身份、情绪、身世、某项制度、某条规定即便都围绕同一个人或同一座宅邸，也各自独立。共享人名、地名或物件名不构成同义。
- 一条条目只讲一件事。若发现已有条目里混进了多件事，按各自主题分别输出：沿用原 id 的那条只保留与 topic 对应的那件事，其余作为新条目输出。
- 只在信息状态真的发生变化时输出该条目：新获知 → known；得到新迹象但仍未确认 → uncertain；被明确推翻/遗忘 → drop。
- 档位变化也算变化：只需改档就输出 {"id":"原 id","importance":"high|normal|low"}，其余字段省略会保留旧值。
- 标记 [锁定] 的条目由用户确认，完全跳过：不修改、不删除、也不要为其输出任何字段。
- 仅重复确认不算变化，不要输出。
- 首次分析（没有已有表）时输出完整的表。`;

/** 条目字段定义（两个模式共用）。 */
export const KNOWLEDGE_ENTRY_SCHEMA = `- base_revision 填表头给出的「当前修订号」；没有已有表时填 0。
- entries 只放本轮需要新增或修改的条目，没有变化就输出空数组。
- 每个条目字段：
  - "id"：修改已有条目时必填且沿用原 id；新增条目省略。
  - "topic"：信息项短标题，不超过 12 个字（如「主角的真实身份」「城北仓库的货」）。修改已有条目时沿用原 topic 原文。
  - "subject"：关联对象，这条信息针对谁/哪样东西。角色写正名（「富川立花」），地点物品写名称（「城北仓库」），通用设定写「世界设定」。同一对象在整批里用同一种写法，不从已有表中已出现的写法另起新名。
  - "status"：只能是 "known" / "uncertain" / "unknown"。
  - "source"：witnessed / heard / read / inferred / none 之一。
  - "importance"：high / normal / low 之一，按「漏掉会不会写出越界或全知的候选」判：会 → high；影响分寸但不破底线 → normal（新条目默认）；设定与场景已明写 → low。多数条目应是 normal。
  - "aliases"：同义说法数组，最多 6 个，每个不超过 12 个字。只放「同一件事的另一种叫法」（简称、旧称、他人称呼），不放描述、判断或整句话，也不要放同段剧情里的其他事实；没有就空数组。
  - "keywords"：用于场景检索的词（人名、地点、物品、事件），最多 8 个，每个不超过 12 个字。只放名词性检索词，不放短语或句子，没有就空数组。
  - "basis"：判定依据，一句话，点到具体的人、事、物。known 写出处（哪段剧情/哪份设定/谁当面说的）；uncertain 写有哪些迹象或传闻、缺什么；unknown 写材料到哪里为止（哪份设定或剧情没写、谁未被告知）。不要写「未交代获取过程」这类空话。
  - "event_time"：可选。正文明确写了时间才照抄原话（日期/时刻/纪年/「第二天」这类相对时点），没写就填空字符串 ""，不要推断。例："2026年10月15日 下午"、"第二天清晨"；不要写"刚刚""现在"这类相对当前时刻的表述，也不要写「某日上午」「下午」「傍晚」这类只有时段没有日期的描述——无法定位就等于没写。
  - "impact"：对候选行动的约束，一句话说明生成选项时该注意什么（如「不得直接叫出真名」「只能以试探口吻询问」）。unknown 项必须写。
- 删除条目只输出：{"id": "原 id", "drop": true, "drop_reason": "原因"}；没有 id 时可改用 topic 定位。
  只有新剧情**明确推翻**该信息时才 drop，并在 drop_reason 里写清是哪一段推翻的。拿不准就改成 uncertain，不要删除。

条目总数控制在 ${MAX_STORED_ENTRIES} 条以内，重要程度从高到低固定为：未知 > 存疑 > 已知。先补齐未知，再补存疑，最后才是已知；放不下时先丢已知、再丢存疑，未知留到最后。`;

/** 独立分析模式的系统提示（写死，不进 PromptEditor、不依赖预设）。
 *  三态定义必须与内置 knowledge_boundary 模块的口径一致（获取过程从严认定、
 *  已知≠熟练、他人内心不可断言），否则注入的结论会和生成侧规则互相打架。
 *  措辞用「背景设定资料 / 角色设定」，不使用宿主专属术语。 */
export const KNOWLEDGE_SYSTEM_PROMPT = `你是「知识边界分析器」，负责判定角色扮演对话中玩家角色（{{user}}）此刻掌握哪些信息、哪些只是怀疑、哪些完全不知道。你只做判定，不续写剧情、不扮演角色、不评价文笔。

${KNOWLEDGE_RULES_BODY}

【输出格式（严格 JSON）】
只输出一个 JSON 对象，不要输出思考过程、解释、Markdown 或代码围栏。对象结构：
{"base_revision": 数字, "entries": [ ... ]}
${KNOWLEDGE_ENTRY_SCHEMA}`;

export type MergedKnowledgeTaskInput = {
  existingTable: string;
  revision: number;
};

/** 合并模式的附加任务：追加在生成请求末尾，替换掉原本「只许 thinking + options」的标签契约。
 *
 *  刻意不复述整套判定规则：生成请求里已有 knowledge_boundary（非全知约束）与
 *  thinking_prompt（思考框架），这里只补生成侧没有的两件事——三态怎么分、补丁长什么样。
 *  写成一整段自然任务而非「附加任务 + 全套规则 + 输出顺序」三段拼接，模型才把它当成
 *  同一件事的两个步骤，而不是两个互不相干的任务。 */
export function buildMergedKnowledgeTask({ existingTable, revision }: MergedKnowledgeTaskInput): string {
  return `【本轮的完整任务】
这次要一并完成两件事：先更新 {{user}} 的知识边界，再依据更新后的边界生成候选。两者是同一次思考的两个步骤，不是两份作业。

判定口径与上面的认知边界规则一致（获取过程从严、已知≠熟练、他人内心不可断言）。每条只归入三态之一：
- known：设定或剧情明确写过 {{user}} 通过看、听、读或被当面告知得到了它；
- uncertain：只接触到传闻、怀疑或可见迹象，尚未确认；
- unknown：没有交代获取过程，或只有读者能看到。他人的内心与打算对 {{user}} 恒为 unknown。
source 记获取方式（witnessed 目击 / heard 听闻 / read 阅读 / inferred 推断 / none 未获取），unknown 只能是 none。basis 一句话点到具体的人、事、物：known 写出处，uncertain 写迹象与缺环，unknown 写材料到哪里为止；不要写「未交代获取过程」这类空话，也不要编造「第 N 条消息」这类位置编号。若上下文里有 <memory_summary> 摘要块，它只用于核对既有条目的出处，不得当作新增条目的依据。
importance 按「漏掉会不会写出越界或全知的候选」判：会 → high；影响分寸但不破底线 → normal（新条目默认）；设定与场景已明写 → low。档位只决定预算紧张时先保谁，不是剧情重要性。已有表里每条都带 [档位=…]，顺带重估：秘密已揭晓、场景已翻篇就降档，只输出 {"id":"原 id","importance":"…"} 即可。不为常态身份/关系/环境单独建条——生成侧本来就看得到。
subject 写这条针对谁/哪样东西：角色用正名（不写「她」），地点物品写名称，通用设定写「世界设定」；同一对象全表统一写法。event_time 只在正文明确写了日期/时刻时才填，不要写「某日上午」「下午」「傍晚」这类只有时段没有日期的描述，写了等于编造。

${existingTable ? `【已有边界表】\n${existingTable}\n\n` : '（这是首次分析，输出完整的表。）\n'}当前修订号=${revision}。只输出真正变化或新增的条目，没有变化就留空数组；标记 [锁定] 的条目完全跳过。条目字段：
{"id":"改已有条目时沿用原 id，新增省略","topic":"不超过 12 字","subject":"关联对象：角色正名/地点物品名/世界设定","status":"known|uncertain|unknown","source":"witnessed|heard|read|inferred|none","importance":"high|normal|low","aliases":["同一件事的另一种叫法，每个≤12字"],"keywords":["名词性检索词，每个≤12字"],"basis":"判定依据","impact":"对候选的约束，一句话","event_time":"正文写了具体时间才填，否则空串"}
删除条目写 {"id":"原 id","drop":true,"drop_reason":"原因"}；只有新剧情明确推翻时才 drop，拿不准改成 uncertain。总条目控制在 ${MAX_STORED_ENTRIES} 条以内，重要程度从高到低固定为：未知 > 存疑 > 已知——先补齐未知，再补存疑，最后才是已知；放不下时先丢已知、再丢存疑，未知留到最后。

【输出顺序】
1. <thinking>：按上面的思考框架分析场景，然后完成知识判定。
2. <knowledge_patch>{"base_revision": ${revision}, "entries": [ ... ]}</knowledge_patch>：只放知识边界 JSON。
3. <options>：照常输出候选 JSON 数组，写的时候守住你刚判定的边界。

这三个标签之外不写任何东西，两个 JSON 块也不得互相混入。`;
}

export type KnowledgeParseResult = { baseRevision: number | null; patches: KnowledgePatch[] };

/** 合并模式下的标签集合：三块而非两块。 */
export const MERGE_TAG_LIST = '<thinking>、<knowledge_patch> 与 <options>';

/** 提示词里「只许两个标签」的写法不止一处（system_prompt / core_rules / thinking_prompt
 *  各说一遍）。合并模式若只在末尾追加一条覆盖说明，模型会同时读到「只许两个标签」和
 *  「还要输出第三个」——冲突的指令比缺指令更糟，弱模型通常跟先出现的那句。故就地改写
 *  这几句，让整份提示词只有一个口径。
 *
 *  用正则而非精确整句匹配：这些模块用户可编辑，标点/措辞常有出入，但「两个标签」
 *  这个关键短语稳定。改写不生效时不报错——末尾的合并任务本身仍声明了三段顺序，
 *  只是退化成需要模型自行调和，不至于完全失效。 */
const MERGE_PROMPT_REWRITES: Array<[RegExp, string]> = [
  // 「只输出 <thinking> 与 <options> 两个标签」
  [/只输出\s*<thinking>\s*与\s*<options>\s*两个标签/g, `只输出 ${MERGE_TAG_LIST} 三个标签`],
  // 「只许出现 <thinking> 与 <options> 两个标签」
  [/只许出现\s*<thinking>\s*与\s*<options>\s*两个标签/g, `只许出现 ${MERGE_TAG_LIST} 三个标签`],
  // 「回到这两个标签」——上一句改写后不再成立
  [/回到这两(?:个)?标签/g, '回到这些标签'],
  // 「核对无误即进入 <options>」
  [/核对无误(?:即|后)进入\s*<options>/g, '核对无误后先输出 <knowledge_patch>，再进入 <options>'],
  // 「<options> 之外一个字都不写」——改写成三标签后这句自相矛盾：
  // <knowledge_patch> 就在 <options> 之前，按原句等于禁止输出补丁块。
  // 契约的真实边界是「options 块之后不再写字」，故改成同一语义的说法。
  [/<options>\s*之外[^，；。]*?不写/g, '</options> 之后一字不写'],
  // 「两个标签之外不写任何文字」等变体（未被上面两条覆盖的独立表述）
  [/这两(?:个)?标签之外[^，；。]*?不写/g, '这三个标签之外不写任何文字'],
];

/** 合并模式下整条丢弃的模块：纯输出格式指令，合并任务自己已声明完整顺序。
 *  assistant_thinking 整条只讲「以 thinking 开头、自检完输出 options」——前半句
 *  thinking_prompt 已覆盖，后半句与补丁块冲突。改写它等于留一句多余的重复，
 *  故整条不发（规则性内容在 core_rules / knowledge_boundary 里，不在这个模块）。 */
export const MERGE_DROPPED_MODULE_IDS = ['assistant_thinking'] as const;

export function isModuleDroppedByMerge(moduleId: string): boolean {
  return (MERGE_DROPPED_MODULE_IDS as readonly string[]).includes(moduleId);
}

/** 只改写标签契约句，其余内容一字不动。纯函数，返回改写后的文本。
 *
 *  与 adaptPromptForMerge 的区别：后者额外删掉「把 {{user}} 的原始输入改写成几个版本」
 *  这类润色分支表述（选项生成时不该提润色）；本函数用于用户自有文本（预设条目），
 *  只统一「输出几个标签」的口径，不动叙事内容。 */
export function rewriteTagContractOnly(text: string): string {
  return MERGE_PROMPT_REWRITES.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

/** 合并模式下改写一段提示词文本。纯函数，返回改写后的文本。
 *
 *  除了标签口径，还压掉 system_prompt 里「或者把 {{user}} 的原始输入润色成几个版本」——
 *  本次是选项生成，润色是另一条链路，留着只会让模型分不清本轮任务。 */
export function adaptPromptForMerge(text: string): string {
  // 选项生成时不应提及润色分支（enrich 链路不走合并）
  return rewriteTagContractOnly(text).replace(/，?或者把\s*\{\{user\}\}\s*的原始输入改写成几个更顺口的版本/g, '');
}

/** 该模块是否需要为合并模式改写：含「两个标签」类写法时才处理，避免无谓遍历。 */
export function needsMergeAdaptation(text: string): boolean {
  return /<options>/.test(text) && /<thinking>/.test(text);
}

/** 只从 <knowledge_patch> 标签内取知识补丁。
 *  不做全文兜底：选项块的 JSON 数组也含 [ ]，全文解析会把候选误当知识条目。
 *  标签未闭合（输出被截断）时截到 <options> 或文末——补丁在候选之前，通常仍完整。 */
export function parseMergedKnowledge(text: string): KnowledgeParseResult | null {
  const open = /<knowledge_patch>/i.exec(text);
  if (!open) return null;
  const rest = text.slice(open.index + open[0].length);
  const close = rest.search(/<\/knowledge_patch>/i);
  const options = rest.search(/<options>/i);
  let body = rest;
  if (close !== -1 && (options === -1 || close < options)) {
    body = rest.slice(0, close);
  } else if (options !== -1) {
    body = rest.slice(0, options);
  }
  return parseKnowledgeResponse(body);
}

/** 剥离知识补丁块，供 parseOptions 前调用：JSON 主路径失败时，括号回退会把补丁里的
 *  [...] 逐行当成伪选项。未闭合形态一并清到 <options> 或文末。 */
export function stripMergedKnowledge(text: string): string {
  return text
    .replace(/<knowledge_patch>[\s\S]*?<\/knowledge_patch>/gi, '')
    .replace(/<knowledge_patch>[\s\S]*?(?=<options>|$)/gi, '');
}
