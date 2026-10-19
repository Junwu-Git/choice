# choice（异步行动选项）

SillyTavern 扩展：独立调 API 异步生成行动选项，玩家点选后填入或发送。TS + Vue 3 SFC + Pinia + Zod + Vite，产物 `dist/`。

## 约定

- 中文回复；注释只解释「为什么」。
- **用户当前的 UI 示例/设计方向/口头指示优先级最高**，可整体换版式，但不破坏功能语义。
- `@sillytavern/...` 签名先核实源码或 TavernHelper 类型，不凭记忆。
- agent 只跑一次性 `build`/`typecheck`/`lint`；`pnpm watch` 留给用户。收尾同步本文件；UI 改动需浏览器验证。

## 技术边界

- 禁 jQuery/手写 DOM、Tailwind/UnoCSS 运行时；拖拽用现有 `sortablejs` 封装。
- 设置只经 `useXxxStore()`；组件不直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`。
- 版本敏感酒馆 API 只在 `src/core/`、`src/store/`、`src/index.ts`；例外放行 `uuidv4`、`util/character-bindings.ts`、`util/option-action.ts`。
- **角色绑定**：入口只写内存 + `setBinding()`，落盘只靠 character-settings deep watch。勿重复 `persistCharacter`（卡顿）；勿用 `saveCharacterDebounced` 存扩展字段（旧 json_data 覆盖→绑定失效）。

## 提示词

- `prompt_source` 双轨：`extension`（默认，本扩展模块管线）/ `st_preset`（完全用酒馆 CC 预设，不读本扩展模块，勿混用）。
- 预设模式**自读预设 + 自组装**，不劫持宿主生成管线（`Generate` 占全局 abortController 与发送按钮）。链路：`st-preset-source` → `preset-extract`（白名单）→ `preset-messages`（按 order 展开，8 个 marker 槽位运行时填充）→ `preset-task`（内置固定任务，不读 `prompt_rules.modules`；`renderBaiBaiSummaryContent` 是摘要包装单一来源）→ `buildPresetModeMessages`。
- 预设模式隐藏提示词配置/模块列表（配置保留），上下文设置（轮数/记忆摘要/结构化记忆源）两模式共用。
- 记忆摘要 depth = 历史条数；`getHistory({ before: historyWindowStart })` 取 `[0,N)`，与正文零重复。本体走 `setExtensionPrompt`，副 API 直连看不到。桥接模块为 `memory-summary-bridge.ts`（`getExternalSummary`）与 `structured-memory-bridge.ts`（`getExternalStructuredBook`）；**运行时契约字符串（全局对象名、第三方存储命名空间与键名）不可改**，其余标识符与注释不出现外部插件名。模块 id `baibai_summary` 与设置字段 `baibai_enabled`/`shujuku_enabled` 是已存配置的键，保留历史命名（改名需迁移）。
- `st_preset_overrides` 覆盖层（键 = identifier，不改预设文件）：`disabled` 优先于 `enabled`；`content` 替换；`content: ''` 明确清空。**两趟展开（含 in-chat 注入）都要应用**，8 个 marker 槽位不受影响。
- **提取白名单**：预设顶层混有 `reverse_proxy`/`proxy_password` 等凭据，只取条目 + 顺序表 + `PRESET_SAMPLING_KEYS`，勿整体展开进请求体；`tests/preset-extract.test.ts` 锁定。
- 采样：`st_preset_sampling` 只覆盖 temperature/top_p/惩罚项/max_tokens（实名 `openai_max_tokens`）；连接层始终用副 API。后处理 `st_preset_post_processing` 由服务端按请求体字段执行。
- 脚本层 `st_preset_script_processing`（默认 off）：`prompt_ready` 广播 `CHAT_COMPLETION_PROMPT_READY`，`tavern_helper` 走 `generateRaw`。**脚本正文绝不进快照或请求体**。
- 模块管线：`order/enabled/enrich_only`；`enrich` 必须在 assistant 模块之前。
- 静态规则（不靠配置）：防全知（已知≠熟练、获取从严、去主角化）、防媚主/极端化、开头句式错开；难度只认剧情已展示的本领。**主体措辞**：候选行动者统称「主体」以兼容「其他角色主体」条目，但 `knowledge_boundary` 必须显式声明「未特别说明时主体默认是 {{user}}」，`core_rules`/`thinking_prompt` 必须约束「首次指代写名字或省略主语的动词句，不用他/她开头」。v74~v81 曾把 `{{user}}` 系统性换成「主体」却没定义默认所指，模型自行用「他」开头指代，同批选项主语忽隐忽现——v82 补回锚点，勿再删。

## 知识边界（默认开）

- 独立分析请求：读 persona + 世界书 + 角色卡 + 同一份 `buildChatHistory` 窗口，判定 `{{user}}` 三态（known/uncertain/unknown）与获取方式（witnessed/heard/read/inferred/none），口径与 `knowledge_boundary` 模块一致（获取过程从严、他人内心不可断言）。**提示词里绝不出现宿主术语**（角色卡 / 世界书 / 酒馆 / 楼层）：模型不知道这些是什么，只会当成剧情里的东西或直接忽略；一律改写成「背景设定资料 / 角色设定 / 剧情 / 第 N 条消息」，`tests/knowledge-merge.test.ts` 有断言锁定。这条也适用于内置模块单一事实源 `choice-prompts-optimized.json`（v83 迁移块负责把老存档的旧文案换掉，exact-match 不动用户自定义）。**世界书必须与生成侧同源**：`before+anBefore+em`、`after+anAfter`、`depthBefore`（历史前）、`depthAfter`（历史后）四段齐全，`buildWI()` 只调一次（EJS 的 setvar 每次执行都有副作用）。**不发 `<recent_floors>` 楼层索引，也不记录楼层号**：历史里没有楼层编号，额外抄一份摘要只会让模型把索引当剧情材料、还容易被 slice 切出半截标签；`evidence_floors` 字段已随 v82 删除（旧档由 `migrateKnowledgeReport` 显式 `delete` 清残留）。时间信息改为 `event_time`：模型从正文/`<SceneInfo>` 等场景元数据里摘录原话（如「2026年10月15日 下午」），读不到留空，不猜、不用现实时间顶替；该字段不参与判定，但**会随注入发给生成侧**（模型据此区分「刚知道」与「早就知道」），面板也展示。
- **历史摘要层**：分析请求在 `buildChatHistory` 之前插入 `getExternalSummary(historyWindowStart(...))`（外部记忆系统可用时），与正文窗口 `[start, 末尾)` 零重复。提示词明确约束：摘要只用于核对已有条目的出处与因果，不得当作新增判定依据；摘要与可见对话冲突时以对话为准。桥接不可用时零变化。
- **账本式条目**：`id`（`kb_` 前缀，创建后不变）、`revision`、`source`、`importance`、`subject`、`aliases`、`keywords`、`event_time`、`previous_status`、`first_seen_message`、`locked`、`retired`。报告带 `revision` 与 `based_on_fingerprint`。
- **关联对象 `subject`**：这条信息针对谁/哪样东西（角色正名、地点物品名、通用设定写「世界设定」）。**只用于面板展示与人工归类，不参与归并匹配、不进注入文本**——共享同一对象只说明涉及同一个人/物，不说明是同一件事（立花的身份/情绪/私情各自独立），与 `keywords` 同理。模型漏填时更新路径保留旧值（`if (patch.subject)`），新条目录空串；`renderExistingTable` 输出 `[对象=…]` 让模型照抄已有写法，避免「立花 / 富川立花」分裂成两个对象。占位词（未指定/无/unknown）判空。
- **`event_time` 要有可定位锚点**：`toEventTime` 除了归一空白与截断，还拦两类伪时间——含「某日/某天/某年」的占位式（模型自己都说不出是哪天），以及只有时段词没有数字/纪年的（「上午」「傍晚」）。合法写法包括「2026年10月15日 下午」「第二天」「三日后」「民国二十三年 秋」「第三纪元 3019 年」。**不做完整日期格式校验**——不同世界观纪年差异太大，套正则会误杀。手动编辑路径复用同一函数（`knowledge-actions` 的 `normalizeEventTime` 直接调 `toEventTime`），两条链路口径必须一致。
- **档位是动态先验，不是静态权重**：`importance: high|normal|low` 语义固定为「漏了会不会写出越界/全知的候选」，**不是剧情重要性**。它不决定排序，只作加性先验：`entrySortScore = 档位(+3/0/−3) + 新鲜度(≤8 楼 +4｜≤30 +2｜≤80 0｜更早 −3) + 场景命中(+5)`。三项都动态，故**全表通胀会自愈**——整表同档时先验相互抵消，排序退化为时间与场景信号（`tests` 有专门断言）。档位只在**状态组内**排序（锁定 → unknown → uncertain → known 命中 → known 未命中仍是安全线，不由分数决定）。同一函数用于容量淘汰（组内从低到高分淘汰）。档位不进注入文本、不参与归并匹配。字段名不用 `weight`（条目池已占用）。补丁缺 `importance` 时更新路径保留旧值（`importance_explicit`），否则模型只回 status 就会静默把 high 降回 normal。`renderExistingTable` 带 `[档位=…]`，模型才可能提出改档；降档触发条件写在提示词里（秘密揭晓/场景翻篇）。**已知项也要减量**：提示词明确「设定或场景已明写的常态身份/关系/环境不单独建条」，否则档位只是让排序好看，条目数仍在涨。
- **别名/检索词清洗**（`toStringArray` / `mergeUnique` / `normalizeList` 三处同口径）：条数（6/8）+ 单条长度（`MAX_ALIAS_LEN`=16 与 `isSentenceLike` 的 >16 闸门对齐，`MAX_KEYWORD_LEN`=24）+ **丢弃句子式项**（`isSentenceLike`：句末标点、可能/是否/因为等情态词、时间推进与完成体叙述、>16 字）。弱模型常把「苏凛可能处于稳定期或发情边缘」这类判断当别名回传，它们不能用于检索、还会让注入表格变成第二份依据说明。截断只会留半句，故整条跳过。**上限是硬的**：`mergeUnique` 先合并再截断（旧实现先 `[...a]` 复制、push 后才判断，满 6 条后每轮仍 +1，别名会滚到几十个）；旧数组一并清洗，迁移路径截断时记一条变更记录。迁移路径也清洗旧档脏数据。
- **归并匹配只用「身份说法」**：条目的身份 = `topic + aliases`，**不含 `keywords`**。`findByAlias` 只拿补丁的 `topic` 去对，**不拿补丁自填的 `aliases` 当匹配键**；`findSimilar` 只比补丁 topic 对条目 topic/aliases。理由：模型会把「同一角色的相关事实」写成别名，共享人名/地名/物品名只说明涉及同一对象，不说明是同一件事——旧实现据此把身份、情绪、身世、制度、规矩全并进一条。代价是「换说法 + 漏传 id」可能多出一条重复（可由「整理条目」回收），误并则会静默丢事实。
- **增量维护**：请求带 `<existing_knowledge_table>`（含修订号、id、来源、锁定标记），模型输出 `{base_revision, entries}`，只给变化条目。合并顺序：id → 主题精确 → 别名精确 → 相似度（活跃条目，Dice ≥0.72 且领先 ≥0.08）→ 新建；相似度领先不足记 `ambiguous` 并新建（可追踪）。主题短于 `MIN_SIMILARITY_TOPIC_LEN`(4) 时不走相似度——纯人名/地名与太多条目共享二元组，靠 Dice 会误并不同的事（精确匹配路径不受限）。锁定条目完全冻结：更新、drop、改名绕过都拒绝并记 `rejected_locked`。退役条目只接受精确命中恢复。补丁缺 `status`/`source` 时更新路径保留旧值（`status_explicit`/`source_explicit` 区分「模型给了 unknown」与「模型没给」），只有新建路径回退 unknown/unspecified——弱模型只回半张表时不能把整表降级成未知。**状态变更只改同一条目的 `status`，旧值写入 `previous_status`**（只留一跳，完整历史在 `last_changes`），不产生副本条目。
- **手动整理**（面板「整理条目」）：`findDuplicateGroups` 全表 O(n²) 扫描（上限 60 条，可忽略），阈值比 AI 路径更严（`MANUAL_DEDUP_THRESHOLD=0.82` / `MARGIN=0.12`）——批量误并会丢信息，漏并只是多一条。额外要求 `isRestatement`：短串二元组覆盖度 ≥0.6 且长度 ≥4，挡住「共享人名但不是同一件事」的误判。锁定与退役条目完全不参与。合并时状态取权威度最高的（known > uncertain > unknown），旧状态记 `previous_status`，别名/检索词/时间全部并入。
- `parseKnowledgeResponse` 返回 `null`=不可解析、`{patches: []}`=合法无变化，两者都必须保留旧表，语义不可混。`重建整表` 是唯一全量重跑入口（`rebuild=true` 传空表）。
- 报告存聊天级 `ChatSettings.knowledge_report`（随聊天落盘，切聊天自动切报告）；`based_on_message` + `based_on_fingerprint` 共同判定过期：编辑/删除/切分支楼层数可能不变，必须看内容指纹（只取可见消息 role + 正文摘要，忽略扩展元数据）。
- 并发守卫：请求前快照 chatIdentity / 楼层数 / 指纹 / `report.revision`，返回后任一不符丢弃结果（手动触发会提示，自动触发静默）。手动编辑同样 bump `revision`，使在途结果失效。
- 存储上限 `MAX_STORED_ENTRIES=60`（锁定条目永不淘汰）、`MAX_RETIRED_ENTRIES=20`、`MAX_CHANGES=20`；活跃条目淘汰顺序 known → uncertain → unknown，同档按 `entrySortScore` 从低到高（即低档位、久未更新先走）。**本轮补丁写过的条目（`touchedIds`）不参与淘汰**——否则锁定占满时新条目会把自己挤掉。锁定占满导致无可淘汰对象时允许临时超限，记 `capacity_full`（面板显示「已满」），不静默丢新条目；退役淘汰同样跳过锁定。
- 注入在 `generateOptions` 的 `runWIExclWindow` 之后、`appendRuntimeLine` 之前——**扩展模式与预设模式共用同一注入点**（预设不读 modules，只有运行时注入能覆盖）。报告为空时零变化。
- 注入由 `knowledge-injection.ts` 负责：`buildSceneText` 取最后 4 条可见消息，按 topic/别名/关键词命中评分；选择顺序 锁定 → unknown → uncertain → known 命中 → known 补齐（组内按 `entrySortScore`）；条数/字符预算来自 `knowledge.inject_max_entries`（默认 24）与 `inject_char_budget`（默认 2500）。**固定头部/分组标题先预扣 120 字**（否则实际注入会超预算）。**有场景文本时**，未命中的 known 最多占 known 配额一半（无场景文本时不砍，否则等于浪费预算），但高权重 known 豁免此配额。**三级降级**：预算放不下完整形态时，known 退化为「- 主题」单行；unknown/uncertain/锁定绝不降级（约束句是它们的全部价值，省掉会变误导），直接省略。**条数上限是硬上限**，降级不突破。`renderKnowledgeInjectionDetailed` 返回 `{block, chosen, omitted, usedChars, total}`，`generator.lastKnowledgeInjection` 供调试页核对。宏必须在代码里 `substituteParams`。`lastBuildMessages` 覆盖为注入后形态供调试页核对。
- 自动刷新统一走 `scheduleKnowledgeRefresh(reason)`：`received` 立即（与选项生成并行），`edited/deleted/swiped` 1200ms 防抖；分析在途只记 pending，结束后补跑一次；`CHAT_CHANGED` 调 `resetKnowledgeScheduling()` 清定时器并取消在途。`knowledgeState.tick` 驱动面板过期提示重算（聊天数组不是响应式）。
- **指纹分层**：尾部 12 条逐条完整参与，更早楼层按步长 8 抽样（头 80 字）——长聊里改掉早期一条「谁告诉了主角什么」同样要触发重算，逐条全量哈希会让每次事件都扫整个聊天。采样点之外的早期编辑可能漏判，属刻意取舍。
- **合并请求**（`knowledge.merge_with_generation`，默认关）：一次请求返回 `<knowledge_patch>` + `<options>` 两块，要求模型先更新边界再写候选。触发条件 `enabled && auto_analyze && merge_with_generation && isKnowledgeReportStale()`——报告新鲜时不追加任务。**「只许两个标签」的写法分散在 3 个模块**（`system_prompt` / `core_rules` / `thinking_prompt`），合并时统一走 `adaptPromptForMerge` 就地改写（`MERGE_PROMPT_REWRITES`，正则匹配「两个标签」等关键短语），**不要整模块跳过**——这些模块里有必需规则。`assistant_thinking` 例外：它整条只讲「以 thinking 开头、自检完输出 options」，前半句 `thinking_prompt` 已覆盖、后半句与补丁块冲突，**整条丢弃**（`MERGE_DROPPED_MODULE_IDS`）。预设模式改 `OPTION_SYSTEM` 契约句 + `OPTION_USER` 收尾句（只改一处会留下「自检完就出 options」的矛盾）。合并任务只补三态/source/字段，不复述 `knowledge_boundary` 已覆盖的规则（已知≠熟练、去主角化等），写成一整段任务而非多段拼接。`panel-mount` 只在「本次确实会自动生成」时跳过独立分析，否则（`auto_generate` 关/生成在途/无 API）仍走独立请求；`edited/deleted/swiped` 永远独立分析。解析隔离：`parseMergedKnowledge` 只读标签内、不做全文兜底；`parseOptions` 前必须 `stripMergedKnowledge`，否则括号回退会把补丁 JSON 当伪选项。补丁与选项互不阻塞；refill 轮次不重复提交补丁。
- 手动编辑集中在 `knowledge-actions.ts`（新增/编辑/锁定/退役/恢复/清空/导入），一律 bump `revision`、写 `last_changes`，不改 `based_on_message/fingerprint`。锁定条目允许手动编辑（用户是最终权威）。`normalizeList` 直接复用 `isSentenceLike`，与 AI 路径同口径。
- **导入/导出**：`buildKnowledgeExport` / `parseKnowledgeExport`（`type: 'choice-knowledge-export'` + `version`）；导出只含活跃条目，导入走与迁移相同的清洗路径，按 id/主题合并、不替换，导入文件的锁定状态不生效（那是别的聊天里用户做的决定）。
- `base_revision` 必须校验：模型回传值非 `null` 且与表头不一致时丢弃本次补丁（分析侧提示、合并侧静默）；`null` = 弱模型漏传，放行（本地 `revision` 守卫仍然有效）。
- 旧报告就地幂等迁移（`migrateKnowledgeReport`，chat-settings 每次校验后执行）：补 id/source/aliases/revision，同 topic 重复条目合并并记 `merged`，并纠正矛盾的三态/来源组合（`unknown → none`、`none + known → uncertain`）。别名超限被截断时记 `updated`（「别名超出上限，已从 N 条清理为 M 条」），不静默丢。不 bump `SCHEMA_VERSION`。**截断只能清脏数据，不能还原已被误并的独立事实**——那些需要用户手动重建或点「重建整表」。
- 纯函数在 `knowledge-report.ts`（解析/合并/容量/表格/指纹/迁移/导出/落库守卫，`tests/knowledge-report.test.ts` 锁定），提示词与合并文本层在 `knowledge-task.ts`（`tests/knowledge-merge.test.ts` 锁定），注入在 `knowledge-injection.ts`，快照/过期判定/落库在 `knowledge-state.ts`，请求与调度在 `knowledge-analysis.ts`。`knowledge-state` 独立存在是因为 `generator` 与 `knowledge-analysis` 都要用，放任一方向会成模块环。**并发守卫 `checkCommitGuards` 放在纯函数层**（不是 knowledge-state）——它必须能被 vitest 直接覆盖。
- **快照必须带 `entries`**：`takeSnapshot()` 深拷贝报告表，`commitKnowledgePatches` 默认以 `snapshot.entries` 为合并基线，不读当前 store。响应回来时表可能已被手动编辑改过，用新表合并会让旧快照的 `messageCount` 覆盖新条目的 `updated_at_message`。

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

## 目录

`src/core/`（生成/解析/骰子/预设/桥接/知识边界）、`src/store/`（schema 唯一来源 `src/type/settings.ts`，SCHEMA_VERSION 83）、`src/components/`（主面板/Floating*/编辑器）、`src/util/`、`tests/`（纯函数单测）、`tools/`。

## 构建

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

- 技能 `sillytavern-extension-dev` 已装在 `~/.zcode/skills/`，含 `getContext()` 全量 API、`event_types` 全表、Vite/manifest 模板与浏览器验证配方。
- 工作区 MCP `chrome-devtools` 已配在本目录 `.zcode/config.json`，但**当前为 `enabled: false`**；浏览器验证走 ZCode 内置浏览器（`browser-use` 插件 / `agent.browsers`）。内置浏览器没有 console/网络面板：加载期错误读 ST 自己的 `#extensions_details` 的 `warning` 类与 `.info-block.error` 文本；请求体/console 需在页面加载后注入 fetch/console 钩子再触发操作（钩子随导航销毁，抓不到加载期错误）。
- 扩展激活约需 10 秒（拉 manifest + 按 `loading_order` 注入 script），轮询 `#choice-floating-root` 或 `script[id="third-party_choice-js"]`，别只查一次。
- `pnpm build` 后必须刷新页面：ST 用 `<script id="third-party_choice-js">` 注入 `dist/index.js`，不刷新不会重新执行。
- 页面内自查：`SillyTavern.getContext()` 可直接读 `extensionSettings.choice`、`chatMetadata.choice`、`extensionPrompts`。
