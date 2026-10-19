# choice（异步行动选项）

SillyTavern 扩展：独立调 API 异步生成行动选项，玩家点选后填入或发送。TS + Vue 3 SFC + Pinia + Zod + Vite，产物 `dist/`。

## 约定

- 中文回复；注释只解释「为什么」。
- **用户当前的 UI 示例/设计方向/口头指示优先级最高**：可整体换版式，但不破坏功能语义。
- `@sillytavern/...` 签名先核实源码或 TavernHelper 类型，不凭记忆。
- agent 只跑一次性 `build`/`typecheck`/`lint`；`pnpm watch` 留给用户。收尾同步本文件；UI 改动需浏览器验证。

## 技术边界

- 禁 jQuery/手写 DOM、Tailwind/UnoCSS 运行时；拖拽用现有 `sortablejs` 封装。
- 设置只经 `useXxxStore()`；组件不直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`。
- 版本敏感酒馆 API 只在 `src/core/`、`src/store/`、`src/index.ts`；例外：`uuidv4`、`util/character-bindings.ts`、`util/option-action.ts`。
- **角色绑定**：入口只写内存 + `setBinding()`，落盘只靠 character-settings deep watch。勿重复 `persistCharacter`（卡顿）；勿用 `saveCharacterDebounced` 存扩展字段（旧 json_data 覆盖 → 绑定失效）。

## 提示词

- `prompt_source` 双轨：`extension`（默认，本扩展模块管线）/ `st_preset`（完全用酒馆 CC 预设，不读本扩展模块，勿混用）。
- 预设模式**自读预设 + 自组装**，不劫持宿主管线（`Generate` 占全局 abortController 与发送按钮）。链路 `st-preset-source` → `preset-extract`（白名单）→ `preset-messages`（按 order 展开，8 个 marker 槽位运行时填充）→ `preset-task`（固定任务，不读 `prompt_rules.modules`；`renderBaiBaiSummaryContent` 是摘要包装单一来源）→ `buildPresetModeMessages`。预设模式隐藏提示词配置/模块列表（配置保留）。
- 记忆摘要 depth = 历史条数；`getHistory({ before: historyWindowStart })` 取 `[0,N)`，与正文零重复。本体走 `setExtensionPrompt`（副 API 直连看不到）。桥接 `memory-summary-bridge.ts`（`getExternalSummary`）、`structured-memory-bridge.ts`（`getExternalStructuredBook`）。**运行时契约字符串（全局对象名、第三方存储命名空间/键名）不可改**；其余标识符与注释不出现外部插件名。`baibai_summary`/`baibai_enabled`/`shujuku_enabled` 是已存配置键，改名需迁移。
- `st_preset_overrides`（键 = identifier，不改预设文件）：`disabled` > `enabled`；`content` 替换；`content: ''` 清空。**两趟展开（含 in-chat 注入）都应用**，8 个 marker 槽位不受影响。
- **提取白名单**：顶层混有 `reverse_proxy`/`proxy_password` 等凭据，只取条目 + 顺序表 + `PRESET_SAMPLING_KEYS`，勿整体展开进请求体；`tests/preset-extract.test.ts` 锁定。
- 采样：`st_preset_sampling` 只覆盖 temperature/top_p/惩罚项/max_tokens（实名 `openai_max_tokens`）；连接层始终用副 API。`st_preset_post_processing` 由服务端按请求体字段执行。
- 脚本层 `st_preset_script_processing`（默认 off）：`prompt_ready` 广播 `CHAT_COMPLETION_PROMPT_READY`，`tavern_helper` 走 `generateRaw`；**脚本正文绝不进快照或请求体**。
- 模块管线 `order/enabled/enrich_only`；`enrich` 必须在 assistant 模块之前。
- 静态规则（不靠配置）：防全知（已知≠熟练、获取从严、去主角化）、防媚主/极端化、开头句式错开；难度只认剧情已展示的本领。
- **主体措辞**：候选行动者统称「主体」以兼容「其他角色主体」条目；`knowledge_boundary` 必须声明「未特别说明时主体默认是 {{user}}」，`core_rules`/`thinking_prompt` 必须约束「**第一次出现主语/宾语指代时写名字**（第二人称写「你」）或省略主语，禁止先用物件/环境分句起头、再用他/她指代」，但**不强制每条都以名字开头**——能省略主语就省略，整批开头仍要错开。**预设模式不读这些模块**，同一条规则必须内置在 `preset-task` 的 `OPTION_SYSTEM`/`OPTION_USER`（v84 补规则、v85 修正过度收紧）；扩展模式旧默认由 v84/v85 片段迁移更新。v82 锚点、v84 收紧与 v85 反过度收紧都勿删。

## 知识边界（默认开）

### 判定与提示词

- 独立分析：读 persona + 世界书 + 角色卡 + 同一份 `buildChatHistory` 窗口，判 `{{user}}` 三态（known/uncertain/unknown）与来源（witnessed/heard/read/inferred/none），口径同 `knowledge_boundary`（获取从严、他人内心不可断言）。**增量窗口**：只有 `received` 用 `resolveAnalysisHistoryStart` 从上次分析前一条开始（旧事实在已有表/摘要里）；`edited/deleted/swiped/loaded` 走完整窗口，避免漏掉被改的旧楼层。
- **提示词绝不出现宿主术语**（角色卡/世界书/酒馆/楼层）：一律写「背景设定资料/角色设定/剧情/第 N 条消息」，否则模型会当剧情材料或忽略。`choice-prompts-optimized.json` 同规则（v83 exact-match 换旧默认，不动用户自定义），`tests/knowledge-merge.test.ts` 锁定。
- **世界书与生成侧同源**：`before+anBefore+em`、`after+anAfter`、`depthBefore`、`depthAfter` 四段齐全；`buildWI()` 只调一次（EJS setvar 有副作用）。
- **不发 `<recent_floors>`、不记录楼层号**：历史无编号，额外索引会被当剧情材料且易切出半截标签；`evidence_floors` 已随 v82 删除（迁移显式 `delete`）。
- **历史摘要层**：`buildChatHistory` 前插 `getExternalSummary(historyStart)`（外部记忆可用时），与正文 `[historyStart, 末尾)` 零重复；增量窗口把 `historyStart` 前移到上次分析处，摘要边界同步。摘要只核对已有条目的出处/因果，不作新增依据；与对话冲突以对话为准。桥接不可用零变化。

### 数据模型

- **账本字段**：`id`（`kb_` 前缀，不变）、`revision`、`source`、`importance`、`subject`、`aliases`、`keywords`、`event_time`、`previous_status`、`first_seen_message`、`locked`、`retired`；报告带 `revision` + `based_on_fingerprint`。
- **`subject`**：信息针对的角色正名/地点物品/「世界设定」。**只做面板展示与人工归类，不参与归并、不进注入**（共享对象≠同一件事，同 `keywords`）。漏填时更新保留旧值（`if (patch.subject)`），新条目空串；`renderExistingTable` 输出 `[对象=…]` 供照抄。占位词（未指定/无/unknown）判空。
- **`event_time`**：从正文/`<SceneInfo>` 摘原话（如「2026年10月15日 下午」），读不到留空，不猜、不用现实时间。不参与判定，但**随注入发给生成侧**（区分「刚知道/早就知道」），面板展示。`toEventTime` 归一空白+截断，拦「某日/某天/某年」与只有时段词无纪年的（「上午」）；**不做完整日期校验**（世界观差异大）。手动编辑 `normalizeEventTime` 调同一函数。
- **`importance` 是动态先验，不是静态权重**：`high|normal|low` = 「漏了会不会写出越界/全知的候选」，**不是剧情重要性**；不决定排序，只加性：`entrySortScore = 档位(+3/0/−3) + 新鲜度(≤8楼 +4｜≤30 +2｜≤80 0｜更早 −3) + 场景命中(+5)`。全表通胀自愈。只在**状态组内**排序（锁定→unknown→uncertain→known命中→known未命中），同一函数用于淘汰。不进注入、不参与归并；字段名不用 `weight`（条目池占用）。缺 `importance` 时更新保留旧值（`importance_explicit`），否则只回 status 会把 high 静默降回 normal。`renderExistingTable` 带 `[档位=…]`；降档条件（秘密揭晓/场景翻篇）写进提示词。**已有表瘦身**：已知项不再重复发 `impact`，存疑/未知的 `impact` 截到 60 字（完整内容仍在报告里）；提示词的条目上限与 `MAX_STORED_ENTRIES`=60 对齐，不再写 30。**已知项也减量**：设定/场景已明写的常态身份、关系、环境不单独建条。
- **别名/检索词清洗**（`toStringArray`/`mergeUnique`/`normalizeList` 同口径）：别名 6 / 检索词 8 条；`MAX_ALIAS_LEN`=16（与 `isSentenceLike` 的 >16 闸门对齐）、`MAX_KEYWORD_LEN`=24；**整条丢弃句子式项**（句末标点、情态词、时间推进/完成体、>16 字）——判断句不能检索还会污染注入表格，截断只留半句。**上限是硬的**：`mergeUnique` 先合并再截断；旧数组一并清洗，迁移截断记变更。
- **归并只认「身份说法」**：身份 = `topic + aliases`，**不含 `keywords`**。`findByAlias` 只拿补丁 `topic` 匹配；**补丁自填的 `aliases` 不当匹配键**；`findSimilar` 只比补丁 topic 对条目 topic/aliases。共享人名/地名/物品名≠同一件事；代价是「换说法+漏传 id」可能重复，误并会静默丢事实。**手动整理同口径**：`findDuplicateGroups` 的身份与相似度也只用 topic+aliases——把 keywords 算进身份会让「富川立花的身份」与「富川立花的私情」凭共享四字人名直接满分合并（三字人名会被 `isRestatement` 的长度闸门挡住，测试容易漏）。锁定改名守卫两边都走 `normalizeTopic`，补丁里多一个括号/标点不能绕过。

### 归并、容量与生命周期

- **增量维护**：请求带 `<existing_knowledge_table>`（修订号/id/来源/锁定），输出 `{base_revision, entries}`，只给变化条目。合并顺序 id → 主题精确 → 别名精确 → 相似度（活跃条目，Dice ≥0.72 且领先 ≥0.08）→ 新建；领先不足记 `ambiguous` 并新建。主题短于 `MIN_SIMILARITY_TOPIC_LEN`(4) 不走相似度（人名/地名二元组重合太多），精确匹配不受限。锁定条目冻结：更新/drop/改名绕过都拒绝并记 `rejected_locked`；退役条目只接受精确命中恢复。缺 `status`/`source` 时更新保留旧值（`status_explicit`/`source_explicit`），仅新建回退 unknown/unspecified——弱模型只回半张表不能整表降级。**枚举识别才算显式**：大小写英文（`Known`/`Witnessed`）归一后识别；无法识别的值按缺失处理（explicit=false），不能拿兜底 unknown/unspecified/normal 覆盖旧值。**只有 id 的补丁必须命中已有条目**，未命中记 `drop_missing` 且不建空主题条目。**状态变更只改同一 `status`，旧值写 `previous_status`**（完整历史在 `last_changes`），不产生副本。
- **手动整理**：`findDuplicateGroups` 全表 O(n²)（≤60 条），阈值更严（`MANUAL_DEDUP_THRESHOLD`=0.82 / `MARGIN`=0.12）——批量误并丢信息，漏并只多一条。额外要求 `isRestatement`（短串二元组覆盖度 ≥0.6 且长度 ≥4，只在 topic/aliases 上比较），挡「共享人名≠同一件事」。锁定/退役不参与。合并状态取 known > uncertain > unknown，旧状态记 `previous_status`，别名/检索词/时间并入。
- `parseKnowledgeResponse` 返回 `null`=不可解析、`{patches: []}`=合法无变化；两者都保留旧表，语义不可混。`重建整表` 是唯一全量重跑入口（`rebuild=true` 传空表）；**rebuild 返回空 entries 时保留旧表**（通常是模型没看懂任务，直接落库会清空含手动/锁定的全部条目）。
- 报告存聊天级 `ChatSettings.knowledge_report`；`based_on_message` + `based_on_fingerprint` 判过期——编辑/删除/切分支可能楼层数不变，必须看内容指纹（可见消息 role + 正文摘要，忽略扩展元数据）。
- **并发守卫**：请求前快照 chatIdentity/楼层数/指纹/`report.revision`，返回后任一不符丢弃（手动提示、自动静默）；手动编辑也 bump `revision`。
- **容量**：活跃 `MAX_STORED_ENTRIES`=60（锁定永不淘汰）、退役 `MAX_RETIRED_ENTRIES`=20、变更 `MAX_CHANGES`=20；解析上限 `MAX_PARSED_ENTRIES`=60 与存储对齐（重建整表时一次输出整张表不会在解析层被截断）。淘汰顺序 known→uncertain→unknown，同档按 `entrySortScore` 低到高。**统一走 `enforceCapacity`**：AI 合并、手动新增、导入、恢复、旧档迁移共用，不能只在合并路径治理（否则一次大文件导入就能把表撑到几百条）。`protectedIds`（`touchedIds`/刚新增/刚恢复）不参与淘汰，否则锁定占满时新条目挤掉自己。无可淘汰时允许临时超限并记 `capacity_full`（面板「已满」），不静默丢新条目；退役同样跳过锁定。
- `base_revision`：非 `null` 且与表头不一致 → 丢弃本次补丁（分析提示、合并静默）；`null`=漏传，放行（本地 `revision` 守卫仍有效）。
- **旧报告迁移**（`migrateKnowledgeReport`，每次校验后）：补 id/source/aliases/revision，同 topic 合并记 `merged`，纠正 `unknown→none`、`none+known→uncertain`；别名截断记 `updated`；最后执行 `enforceCapacity`（迁移是唯一扫全表的入口，历史遗留的超大表也要收敛）。不 bump `SCHEMA_VERSION`。**截断只清脏数据，不能还原已误并的事实**（需手动重建）。
- **导入/导出**：`buildKnowledgeExport`/`parseKnowledgeExport`（`type: 'choice-knowledge-export'` + `version`）。导出只含活跃条目；导入走同一清洗路径，按 id/主题合并不替换；导入的锁定状态不生效；导入后同样执行容量治理并返回 `evicted`（UI 提示淘汰条数）。
- **快照带 `entries`**：`takeSnapshot()` 深拷贝，`commitKnowledgePatches` 以 `snapshot.entries` 为合并基线，不读当前 store；否则旧 `messageCount` 会覆盖新条目的 `updated_at_message`。

### 注入与调度

- 注入点在 `generateOptions` 的 `runWIExclWindow` 之后、`appendRuntimeLine` 之前，**扩展/预设模式共用**；报告为空零变化。
- `knowledge-injection.ts`：`buildSceneText` 取最后 4 条可见消息，按 topic/别名/关键词命中评分；顺序 锁定→unknown→uncertain→known命中→known补齐（组内按 `entrySortScore`；**锁定组内 unknown→uncertain→known**，预算紧张时先保约束项，渲染分组仍按 known→uncertain→unknown）。预算 `knowledge.inject_max_entries`=24、`knowledge.inject_char_budget`=2500，**固定头部先预扣 120 字**。**有场景文本时**未命中 known 最多占 known 配额一半（高权重豁免；无场景不砍）。**三级降级**：放不下完整形态时 known 退化为「- 主题」单行；unknown/uncertain/锁定绝不降级，直接省略；**条数硬上限**不突破。**一条都放不下时仍输出头部 + 「未注入具体条目」的非全知提醒**（静默返回空会让模型以为没有约束）；尾部省略文案统一为「未注入」。场景命中数复用 `scored` 的结果，不再二次扫描。`renderKnowledgeInjectionDetailed` 返回 `{block, chosen, omitted, usedChars, total}`，`lastKnowledgeInjection` 已在调试页展示；宏必须 `substituteParams`；`lastBuildMessages` 覆盖为注入后形态。
- `scheduleKnowledgeRefresh(reason, force, delta)`：`received` 立即（并行生成，`delta=true`）；`edited/deleted/swiped/loaded` 1200ms 防抖（完整窗口）；`force=true` 表示指纹覆盖不到的早期楼层被编辑，只跳过过期判定（功能开关/API 仍生效）；**未触发的防抖任务与在途 pending 会合并需求（force 取 OR、delta 取 AND）**，后续 `received` 不能把之前那次完整窗口/强制分析冲掉；`CHAT_CHANGED` 调 `resetKnowledgeScheduling()` 清定时器并取消在途。`MORE_MESSAGES_LOADED` 还要 bump `knowledgeState.tick`，让面板过期提示立即重算。
- **指纹分层**：尾部 12 条逐条**全文**参与（不再截 400 字），更早按步长 8 抽样（头 80 字）。未抽样楼层的编辑不改变指纹，由 `MESSAGE_UPDATED` + `isMessageCoveredByFingerprint` 按楼层位置强制分析兜底；隐藏楼层不参与指纹。

### 合并请求（`knowledge.merge_with_generation`，默认关）

- 触发：`enabled && auto_analyze && merge_with_generation && isKnowledgeReportStale()`；一次返回 `<knowledge_patch>` + `<options>`，先更新边界再写候选。
- **「只许两个标签」分散在 3 个模块**（`system_prompt`/`core_rules`/`thinking_prompt`），统一 `adaptPromptForMerge` 就地改写（`MERGE_PROMPT_REWRITES`），**不要整模块跳过**（内有必需规则）。`assistant_thinking` 整条丢弃（`MERGE_DROPPED_MODULE_IDS`）。预设模式改 `OPTION_SYSTEM` 契约句 + `OPTION_USER` 收尾句。
- 合并任务只补三态/source/字段，不复述 `knowledge_boundary` 已有规则，写成一整段。
- `panel-mount` 仅在「本次确实会自动生成」时跳过独立分析；否则（`auto_generate` 关/在途/无 API）仍走独立请求；`edited/deleted/swiped` 永远独立分析。
- 解析隔离：`parseMergedKnowledge` 只读标签内、不全文兜底；`parseOptions` 前必须 `stripMergedKnowledge`，否则括号回退会把补丁 JSON 当伪选项。补丁与选项互不阻塞；refill 不重复提交补丁。

### 模块职责

- 纯函数 `knowledge-report.ts`（解析/合并/容量/表格/指纹/迁移/导出/落库守卫，`tests/knowledge-report.test.ts`）；文本层 `knowledge-task.ts`（`tests/knowledge-merge.test.ts`）；注入 `knowledge-injection.ts`；快照/过期/落库 `knowledge-state.ts`；请求与调度 `knowledge-analysis.ts`。
- 手动编辑 `knowledge-actions.ts`（新增/编辑/锁定/退役/恢复/清空/导入）：bump `revision`、写 `last_changes`，不改 `based_on_message/fingerprint`；**时间锚点用 `currentMessageCount()`**（不是分析基线 `based_on_message`），否则长聊里用户刚改的条目仍按旧条目计算新鲜度；锁定条目允许编辑（用户最终权威）；`normalizeList` 复用 `isSentenceLike`。
- `knowledge-state` 独立存在是因为 `generator` 与 `knowledge-analysis` 共用，反向会成环。**`checkCommitGuards` 放纯函数层**（不是 knowledge-state），须被 vitest 覆盖。

## 生成链路

- WI 临时改写一律走 `generator.runWIExclWindow`（save/restore 全局状态，构建完即还原）；`persist-gate.ts` 窗口期推迟自身持久化，否则空绑定落盘。
- 结果写 `message.extra['choice']`，按 `swipe_id` 分层；`generations[]+currentIndex` 翻页，润色另用 `enrichGenerations`。
- 条目池：`master_pool` 是唯一内容源，`configs[]` 只引用/覆盖 `enabled/pinned/weight`；选择覆盖式 `chat > character > default`，不合并。`PoolConfig.rules` 内联在 `{{pool_selected}}` 末尾。抽取以 `pool-resolver.ts` 为准；`cross_layer_fallback` 已删。
- 输出：`<options>` 内 JSON `{"title":"标题|档位|需求值","content":"正文"}`，失败回退 `[标题]内容`；解析在 `option-parse.ts`（有单测）。
- **提取起点自后向前逐区间试**（`collectOptionRegions`）：取第一个开标签或兜底首个候选会退化成伪选项。括号回退两道闸门：`isPlausibleBracketTitle` + `isOptionAnchor`（行首或「…：」后）。
- 条目库 AI 生成：`POOL_GEN_SYSTEM_PROMPT` 写死；`parsePoolGenItems` 与 `parseOptions` 刻意分离，勿合并。

## 骰子（默认关）

- 标题 `[标题|档位|需求]`，未标按档位兜底（DND 35/60/85，COC 65/40/15）。D100：≥96 大成功、≤5 大失败、≥需求成功；点数越大越好。
- 开关：`low_roll`（反向）、`attr_dc_enabled`（刻度自适应）、`allow_formula`、`reroll_enabled`；方向集中在 `dice.ts`。
- 注释（`buildDiceMarker`）三段：固定头部（**margin 必传**）+ 模板正文 + `DICE_MARKER_TAIL`。程度用 `degreeBucket` 单一入口按空间占比切档。
- 注释经 `stagePendingTurn` 在 MESSAGE_SENT 回写进消息，输入框/聊天不可见、随消息持久化；失败保留、CHAT_CHANGED 清空。
- 正文 AI 注入只有 `dice-contract.ts`（常驻契约 + 回写），新增注入必须进此文件。`low_roll` 时追加 COC 语义教学行。
- 需求徽标/判定 chip 主面板与悬浮球各自实现，改动两处同步；徽标语义色 `rateClass` 按判定方向分档（low 镜像）。

## 统计（默认关）

- 只计选项视图，关 = 零写入；按生效 `config.id` 分桶（无 config = `'__none__'`）。
- 命中 = 生成时写 `matchedEntryId`；本地匹配 type 前缀优先 → Dice ≥0.25 且最优-次优差 ≥`OPTION_MATCH_MARGIN`(0.05)，平票归 null；前缀要求最长命中 type 唯一。
- 期望 = 采纳感知基线 + 平均点选数超几何校正（`AVG_PICKS_MIN_ROUNDS` 起效）；`recent` FIFO 50。

## UI

- `--choice-primary` 蓝系卡片化，移动端优先（~380px）。
- 选项行样式（`.choice-option-*`/`.choice-roll-chip`）只在 global.css；悬浮球独立版式但复用解析/行为层。
- `setEntryVisible` 拒绝关闭最后一个入口。z 序：panel 10 / floating 30000 / dialog 30100 / dropdown 30200 / popover 30300。
- i18n：中文源串做键；改文案跑 `pnpm i18n:check`；插值勿嵌反引号模板。
- 引导单一来源 `guide-content.ts`；唯一 `v-html` 在 `OnboardingWizard`（静态内容）。

## 目录与构建

`src/core/`（生成/解析/骰子/预设/桥接/知识边界）、`src/store/`（schema 唯一来源 `src/type/settings.ts`，SCHEMA_VERSION 83）、`src/components/`（主面板/Floating*/编辑器）、`src/util/`、`tests/`（纯函数单测）、`tools/`。

```bash
pnpm build      # → dist/index.js + dist/index.css
pnpm typecheck  # vue-tsc --noEmit
pnpm lint
pnpm test       # vitest 纯函数单测
pnpm i18n:check # 缺失/孤儿键门禁
pnpm format
npx knip        # klona/pinia/toastr 在 ignoreDependencies
```

纯函数核心（pool-resolver/dice/option-format/option-attribution）改前先 `pnpm test`。TS 锁 `6.0.0-beta`（TS7 与 vue-tsc 3.3 不兼容）。

## 分支

- `main` 发布线（dist 归 bot bundle），`test` 是主战场。
- 大版本：`git merge test --no-ff -X theirs --allow-unrelated-histories`，之后 `git restore --source=<旧 main sha> dist`；信息带 `[release ...]`。
- bugfix：`cherry-pick -n`，dist 保留 main 侧。
- **依赖更新只走 `chore/dep-updates`，严禁提交 main**（否则用户白收更新提示）。

## 已移除（勿回填）

卡牌（v77）、自动化（v78）、金手指桥接、`option_style`（v76）、骰子回合槽。重做先出计划。

- 迁移块不能删：zod strip 的键会残留落盘，必须显式 `delete`；新块先 grep 版本号（v79 已占用）。
- `cardSettled` 字段名保留（现只做骰子防重），改名会让旧消息失效。

## 已核实接口

- `generateQuietPrompt`/`Generate` 不采用（无 signal、占全局 abort、emit 生成事件）。
- `getPresetSettings()` 对 openai 返回空对象；读内容用 `getCompletionPresetByName`，先 `getAllPresets()` 预检。
- `setExtensionPrompt(key, value, position, depth, scan, role, filter)`；空 value 被过滤。
- `/api/characters/edit` 的 `json_data` 必须是完整卡 JSON。

## 开发环境（ZCode）

- 技能 `sillytavern-extension-dev` 在 `~/.zcode/skills/`（`getContext()` 全量 API、`event_types`、Vite/manifest、浏览器验证配方）。
- `chrome-devtools` MCP 在 `.zcode/config.json` 但 **`enabled: false`**；验证用 ZCode 内置浏览器（`browser-use` / `agent.browsers`）。无 console/网络面板：加载期错误读 `#extensions_details` 的 `warning`/`.info-block.error`；请求体/console 需加载后注入 fetch/console 钩子再触发（导航即销毁）。
- 扩展激活约 10 秒（manifest + `loading_order`），轮询 `#choice-floating-root` 或 `script[id="third-party_choice-js"]`。
- `pnpm build` 后必须刷新页面（ST 按 `<script id="third-party_choice-js">` 注入 `dist/index.js`）。
- 页面自查：`SillyTavern.getContext()` 读 `extensionSettings.choice`、`chatMetadata.choice`、`extensionPrompts`。
