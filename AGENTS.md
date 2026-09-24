# choice（异步行动选项）— 项目说明

SillyTavern 第三方扩展，基于 `tavern_extension_template`
二次开发。核心功能：单独调用 API 异步生成行动选项，供玩家点选后填入或发送。技术栈为 TypeScript + Vue 3 SFC + Pinia +
Zod + Vite；发布产物是 `dist/index.js` 与 `dist/index.css`，production 构建还会生成
`dist/index.js.map`。扩展会随仓库安装到酒馆真实扩展目录后加载。

## 与我协作时的约定

- **内容性质与优先级**：本文档内容分两类——**约束/不变量**（功能正确性，不得违反）与**现状快照**（当前实现/风格的描述，信息性、可推翻）。**用户当前给出的 UI 示例、设计方向或口头指示优先级最高，高于本文档任何「现状」描述**。重建/改版 UI 时以用户给的示例为准，允许整体替换现有主题色、布局、组件与视觉语言，不必延续文档记载的既有风格；只要不破坏「约束/不变量」里的功能语义（如持久化、状态机行为），外观怎么改都行。
- 回复用中文。
- **每次改动都要检查本文件（AGENTS.md）并在改动完成时同步更新**：任何会影响架构、目录结构、导出面、持久化格式、UI 状态机或验证/环境约定的改动，落实后要顺手把对应条目从“待办/规划”改成“现状”（或反之），防止文档随项目漂移——本文档先前就曾因为未同步积累了大量事实性错误。改动收尾前自查一遍：新引入的模块/字段/命令是否已写进目录或约束小节；已删除的功能是否仍被当“现状”描述。不要把等待实现的设计目标误写成已实现。更新时保持「约束/不变量」与「现状快照」两种措辞区分：现状用陈述句写「当前是…」，**不要写成「不要/必须/严禁」的命令式**；纯风格断言一律标注为现状、可改。用户示例高于文档描述。
- 代码注释使用简体中文、简洁，解释“为什么”而不是“做什么”；覆盖规则、抽取算法、UI 状态机等容易被简化写错的地方，注释必须说明不能直接简化的原因。
- 任何来自 `@sillytavern/...` 的导入，函数签名和导出名都不允许凭记忆假设。实现前必须去当前 clone 的真实酒馆源码或
  `TavernHelper` 类型定义核实，并把核实结论写进必要的代码注释，方便酒馆升级后复查。
- `pnpm watch`
  由用户在独立终端运行（`vite build --watch --mode development`，不是 HMR，只是自动重打包）；agent 不要自行运行常驻 watch。agent 使用一次性的
  `pnpm build`、`pnpm typecheck`、`pnpm lint` 等命令自查。watch 编译完成后还要手动刷新酒馆页面才会加载新产物。
- 核心交互链路或 UI 改动需要实际浏览器验证；文案、样式微调、纯逻辑且不影响 UI 的小改动可由用户决定是否验证。需要验证时，说明在浏览器中的具体操作步骤，并检查 console。

## 关键架构约束

- **技术栈边界**：使用 TypeScript、Vue 3 SFC、Pinia、Zod 和原生 CSS custom property。不引入 jQuery 或手写 DOM 结构（例如
  `document.createElement`、拼接 `.innerHTML`）。拖拽排序统一使用现有的 `sortablejs` 封装（`src/util/sortable.ts` +
  `shared/DragHandle.vue`）。不引入 Tailwind/UnoCSS 等原子化 CSS 框架；仓库虽有 `tailwindcss` 与
  `eslint-plugin-better-tailwindcss` 开发依赖，但 Vite 未接入 PostCSS，CSS 入口也没有
  `@import "tailwindcss"`，不要把它们接入运行时样式。
- **设置一律走 Pinia store**：组件不直接读写 `extension_settings`、`chat_metadata` 或
  `character.data.extensions`；通过对应的 `useXxxStore()` 读写。与酒馆状态同步的实现集中在 `src/store/`。
- **角色绑定/解绑是唯一直接写 `character.data.extensions`
  的例外**（角色卡设置无全局 store 可承载）：入口（PoolEditor/PromptEditor 绑定按钮、ConfigBindings 解绑）**只同步写内存 + 通过
  `useCharacterSettingsStore().setBinding()` 替换设置对象**（UI 即时响应），持久化仅由 character-settings store 的 deep
  watch 统一排队落盘（单一通道：`scheduleCharacterPersist` → `persistCharacter`，直接 POST
  `/api/characters/edit`，json_data 以角色加载时的完整卡 JSON 为基底合并最新
  `data.extensions`）。角色卡 JSON 序列化必须延后到 Vue 绘制之后，且同一角色的连续保存任务要合并、按最新 revision 顺序执行。
  **入口不得再显式 `persistCharacter`**——否则一次点击会重复全量序列化/写卡，是「绑定卡顿」的根因；`onCreateConfig`
  的 bindChar 同理只调用 `setBinding`。**禁止组件直接动态写 `settings[field]`**：必须走
  `setBinding`，否则可能出现 store 已更新而编辑页 DOM 仍停留旧状态。**严禁用 `saveCharacterDebounced`
  持久化扩展字段**：它触发表单提交，以加载时的旧 json_data 快照重建 data，刚写入的字段会被旧快照覆盖（「绑定无效」根因）。唯一受控例外是 v33/v44 迁移期的
  `rebindConfigId`/`rebindPromptConfigId`
  回写（回写字段本就存在旧快照、不会被覆盖）；实时绑定路径严禁复制该模式。绑定/解绑入口不得把 `await`
  网络持久化放在 store 更新之前，否则 UI 会迟钝；ConfigBindings 解绑的当前角色判断用**对象引用比较**（`ch === getStCharacter(this_chid)`，与 store
  watch 落盘目标同源），不用 chid 字符串/索引比较（chid 是数组扫描索引、currentCharacterId 是事件驱动的 this_chid 快照，来源不同会失配导致 store 未清、标记残留）；非当前角色解绑的
  `persistCharacter` 必须 fire-and-forget， `revision++`/toastr 不阻塞在 await 之后。
- **酒馆 API 导入边界**：`src/core/` 与 `src/store/`
  是版本敏感酒馆 API 的主要隔离区。现有组件仍保留少量已核实且必要的稳定导入（例如
  `uuidv4`、发送框或世界书相关调用），不要为了追求形式上的“零导入”而凭空改造接口；新增版本敏感的生成、世界书、正则引擎 API 时优先收敛到 core/store，并先核实真实签名。
- **第三方桥接必须可选**：不能把 TavernHelper 或第三方插件内部数据结构当作柏宝书、数据库等插件的硬依赖。`baibai-bridge.ts`、`ejs-bridge.ts`、`shujuku-bridge.ts`
  等桥接模块必须检测能力，不可用时主体功能仍可用。
- **提示词组装必须走角色结构**，不能把整段内容拼成单条 user 消息：
  - `system`/`systemPrompt` 放提示词编辑区的规则（人称、格式、字数等）。
  - `user`/`prompt` 放抽中的固定/随机条目素材和按上下文模式截取的内容。
  - 可选 `assistant`/`prefill` 放输出格式起手式；预填充开启时保持
    `assistant`，关闭时仅将「思维链预填」与「润色应答」两个模块的角色转换为 `system`，其他模块与提示词顺序不变。
  - 优先使用已核实签名的 `TavernHelper` 或酒馆原生生成接口的角色消息结构；不要凭记忆假设
    `generateRaw`、`generateQuietPrompt` 或 `AbortSignal` 参数。
- **条目池是 `master_pool + PoolConfig` 两层结构**：
  - `master_pool` 是全局唯一内容真相源，保存 `id/type/content/rule/category` 以及默认 `pinned/weight`。
  - `configs[]` 是配置层，决定引用哪些条目，并可覆盖 `enabled/pinned/weight` 等配置项；配置不持有条目正文。
  - config 选择是覆盖式：`chat.config_id > character.config_id > default`，命中后只使用该 config，不合并多个 config 的 entries。
  - `effectivePool` 是 master_pool 中被选中的条目叠加配置覆盖后的结果。内容、类型、规则和分类必须从 master_pool 读取。
  - 常见 footgun：合并多个 config；从 config 读取 content；忽略
    `PoolConfigEntry.enabled`；把全局抽取参数误放回单条 config。
- **提示词配置同样覆盖式选择**：`prompt_config_id` 遵循
  `chat > character > default`，不要假设提示词配置全局唯一。运行时工作副本（`prompt_rules.modules`，生成链路的实际输入）在用户尚未在提示词页做过配置切换/加载（`promptEditConfigId`
  为空）时自动跟随生效配置（`global-settings.ts` 的
  `syncEffectivePromptConfigToWorkCopy`）；模块编辑经深度 watch 即时回写当前归属配置快照，避免「编辑→刷新→切配置」场景的快照覆盖丢失。
- **楼层持久化挂在消息对象上**：结果写入对应 AI 消息的 `message.extra['choice']`，再按 `swipe_id`
  分层，避免切楼层或切 swipe 时串历史。同一楼层多次生成使用 `generations[] + currentIndex` 翻页；润色结果另有
  `enrichGenerations` / `enrichCurrentIndex`。`ChoiceGeneration` 含
  `poolEntryIds`（本轮实际进入候选菜单的池条目 id 集合——固定必发 pinned 与抽签候选均计入，随消息持久化，供条目级统计/智能权重分析）与
  `scopeId`（生成时的统计维度，信息性字段，可选）。
- **行动选项统计**（`GlobalSettings.stats` + 两个独立开关：`GlobalSettings.stats_enabled` / `GlobalSettings.automation_enabled`，`src/core/stats.ts`
  读写，随 extension_settings 持久化）：**`stats_enabled`（默认关）= 统计采集总开关**——关 = `recordOptionsGenerated`/`recordOptionSelected` 早退实现零采集，统计页只显示「统计未开启」横幅 + 历史只读；开 = 自开启时刻起积累新数据、既有历史保留。**`automation_enabled`（默认关，依赖统计开启才有意义）= 自动化开关**——关 = 建议引擎/阵容计划/L1 归因/L2 分析各自早退停用，统计页显示纯报表（卡片/趋势/条目榜/命中榜/管理），隐藏 AI 增强/阵容计划/应用历史/建议徽标/洞察标签等全部自动化区块（顶部「统计与自动化」控制区常驻两个开关，可随时开/关，维度条撤销按钮保留、`apply_history` 与统计解耦不清）；开 = 在统计数据基础上启用自动化。只想看统计的用户开 `stats_enabled` 即可。只计行动选项视图——`generateOptions`
  成功路径按实际保留条数计生成，`applyOptionBehavior`（option-action.ts）在 `view='options'`
  时计选择；润色视图完全不计入。**v51 起按 config 维度记录**： `stats.entries` 键 = 生效
  `config.id`（`chat > character > default` 解析，无 config 会话 = `'__none__'`），每条记录 `ScopeStats`（总量 +
  `by_entry` + 按天 `daily` + 维度级 `updated_at`——本维度最近生成/选择时间戳，AI 理由失效判定按它而非全局时间戳，避免跨维度活动误触发重跑）；全局视图（汇总卡片/趋势/条目榜「全局」档）由 `buildStatsView(stats, '__global__')`
  聚合推导、单一真相源，不双写。**归因口径**：参与（`rounds_included`）= 进入候选（轮次共现，每轮 `poolEntryIds`
  全记，含 pinned）；命中（`rounds_with_selection`）= 精确归因——生成时对每条输出选项与候选条目做文本相似度匹配（`src/core/option-attribution.ts`：type 前缀精确匹配优先——信号按 type 长度降序保证最长优先；字符 2-gram
  Dice 阈值 `OPTION_MATCH_THRESHOLD` 兜底；候选信号由 `prepareMatchSignals` 每轮预计算一次复用），结果写入
  `options[].matchedEntryId`
  随消息持久化；点击只对匹配条目计命中，被 AI 舍弃的候选不产生命中，匹配不上的选项（AI 自由发挥）不命中任何条目；旧代（无
  `matchedEntryId`）点击回退整轮共现兼容；同代去重按「条目 × 代」粒度——窗口内以该条目该 gid 记录的 `hit`
  为准（同代同条目只计 1 次、同代不同条目互不吞，兼容整轮多选），窗口无记录（旧代/被滚动挤掉）回退
  `last_hit_generation_id` 全局单槽整轮去重。 **期望命中率（采纳感知随机基线）**：期望只在该条目被 AI 采纳输出的轮次累计
  `expected_sum += matched/count`（count = 该轮实际输出条数，matched
  = 该条目本轮被匹配到的输出数——用户随机点选命中其任一输出的概率是 matched/count，同条目多条输出基线随之抬高而非按 1 计，避免多输出条目超额系统性偏高被误提权）——AI 完全自由发挥的轮次所有条目不累计期望也不产生命中，避免 v53 前「期望恒 1/count、命中仅精确」的不对称系统性负超额；全量超额 = 命中轮次/参与轮次 −
  expected_sum/参与轮次；固定阈值（15%/60%）已废弃——count 不同随机基线不同（4 条 25%、10 条 10%），固定阈值会误判。
  **滑动窗口**：`recent`（FIFO，上限 `STATS_WINDOW_SIZE`=50）每轮记 `{gid, ts, hit, count, matched}`（matched
  = 该条目本轮被匹配到的输出数，老记录缺省按 1 回退旧口径），窗口期望同采纳感知口径；选择时按 `gid`
  回写 hit（窗口挤掉旧代则全量计数照记、窗口回写跳过）；命中归属 scope 优先 = 生成时持久化的
  `ChoiceGeneration.scopeId`（点击侧直传，避免切 config 后记错维度），旧代缺省时再由 `findHitScope`
  全局搜索定位，最后回退当前生效维度。 `by_entry` 记录含 `last_selected_text`（最近命中选项正文，parse 后去标头）与
  `last_included_at` （最近参与时间戳）——单槽近似（非历史 log），供条目榜 tooltip 与命中榜展示。
  **命中榜纯函数**（`hitLeaderboard`）：只列精确命中 >0 的条目，按命中次数降序 → 最近选中时间倒序，replace 了早期按 type 聚合的类型榜（type 在此扩展中多为条目标题、与条目榜重复）。
  **建议引擎**（`entrySuggestion` 纯函数，`SUGGEST_MIN_SAMPLES`=10 样本门槛，数据源优先窗口、否则全量）：超额 ≤−0.2
  → 降权（`SUGGEST_WEIGHT_MIN`=0.2 下限，减半）；超额 ≥+0.15
  → 提权（上限 5，`SUGGEST_UPGRADE_MULTIPLIER`=1.5 保守倍率——提权不改变期望、翻倍会加速权重向上限收敛，放缓幅度缓解权重分散度劣化）；超额 ≤−0.3 且 0 命中，或样本充足且期望=0（输出中从未被采纳）→ 停用（`enabled=false`，停用后不再进 effectivePool 无新数据、不会自动恢复）；pinned 跳过（固定必发，权重无意义）；**已停用条目跳过**（`effectiveEnabled=false`
  不再重复建议，行内标「已停用」，杜绝「停用后标签永远挂着」的口径不自洽）；
  **已删除条目跳过**（`deleted=true`，master_pool 已无此 id，建议与写入均无意义，含展示标签一并屏蔽）；config 维度下未被当前 config 引用但保留历史统计的条目只展示洞察，不进入可应用建议集合，避免
  `applySuggestions` 找不到覆盖层引用而产生「永远无法应用」的幻影建议；
  **权重边界零差异建议返回 null**（降/提权目标值经 min/max 钳制后与当前值相等时不出建议，避免「应用 0 变更批次 + 误刷冷却 + 再建议」空转）。
  **冷却（防振荡）**：自动化调整（建议应用/阵容落出/补入改写 weight 或 enabled）会给受影响条目打
  `last_weight_changed_at` 时间戳（`StatsEntryEntry` 字段）；`entryMetrics` 对该条目只统计此时间戳之后的窗口记录、不足
  `SUGGEST_MIN_SAMPLES`
  轮新数据返回 null（「冷却中」不评级不落出），全量兜底此时禁用（含变更前数据）——保证建议基于新权重下的真实表现、防止 1↔2↔4 权重颠簸。从未调整（=0）的条目行为与旧版一致。**应用走 config 覆盖层**：
  `applySuggestions(scopeId, list)` 直写目标 config 的
  `PoolConfigEntry`（weight/enabled），应用前存受影响条目的局部快照（`snapshotEntryRefs`，只含本批改写的条目 id，非
  `config.entries`
  全量——撤销/摘要只依赖受影响集，避免大池下历史体积随条目数膨胀）+ 受影响条目冷却标记，批次连同局部快照入 **持久撤销槽
  `apply_history`**（`GlobalSettings` 顶层字段，上限
  `APPLY_HISTORY_LIMIT`=20，刷新不丢；「清空统计」不清它）；撤销均为**按条目条件逆操作**（`restoreApplyEntry`：对批次快照逐条字段级 diff——仅当当前值仍等于该批应用后的值、未被后续批次或手动编辑改动时才回滚对应 weight/enabled 字段，本批新增引用（roster
  promote）整体未被改动时删除，被干扰的条目跳过保留现状，不整表回退吞掉后批），连带恢复被回滚条目的冷却标记（config 已删除的死槽移除）；
  `undoLastApply(scopeId?)` 从末尾逐槽撤销最近批次，`undoApply(entryId)` 按 id 撤销面板指定批次；
  `applyHistorySummary(entry, masterPool)`
  纯函数 diff 前后快照出变更摘要（加入/启停/权重 x→y）；不显式调saveSettingsDebounced（settings deep
  watch 统一落盘）。**v51 迁移把老 stats 清零重来**（老档 `by_entry`/`daily` 是跨维度混合数据无法拆分，用户确认丢弃）。
  **评级解析共用于建议引擎与阵容计划**（`entryMetrics`
  纯函数：窗口 ≥10 轮优先、否则全量 ≥10 轮，返回统一后的 samples/rate/expected/excess/basis；样本不足返回 null；含冷却过滤见上）。`entrySuggestion`
  与 `planRoster` 均基于它，防止两处解析逻辑漂移。 **阵容计划**（`planRoster`
  纯函数，半自动，与建议引擎并存）：建议引擎管权重（池内出现概率），阵容计划管成员资格（谁在池里）。用户设目标在役条数 N（`settings.roster_size`，null=关闭；
  `settings.roster_enabled` 开关），`planRoster` 生成落出/补入清单——落出 =
  config 层软停用（`enabled=false`，条目保留、统计不丢），补入 = 引用进 config。落出：在役 >
  N 时从「可评级且非 pinned」按超额升序（表现最差在前）裁末尾到 ≤N，pinned/样本不足豁免导致的溢出接受（exempt 说明）；补入：空位由替补席（config 中 disabled 且 ∈
  master_pool）优先（按超额降序、样本不足排后），剩余空位按
  `ROSTER_EXPLORE_RATIO`=0.5 上限从未入池条目探索补入（确定性顺序避免 computed 重算抖动）。
  `applyRosterPlan(scopeId, plan)` 写 config 层，同样入 `apply_history`
  持久撤销槽（与建议应用各占一槽、逐槽撤销、跨 config 互不串扰）。target 非法（<1/NaN）或条目库为空 →
  noop 空计划。统计页
  `Statistics.vue`（统计页，单子区，简化模式也显示；位于内容/生成页之后）提供：维度切换（全局 / 未绑定档 / 各 config 下拉，默认当前生效维度；无 config 时引导创建 default
  config——自动引用 master_pool 全量后即可应用建议）、**布局为单页分区 + 可折叠面板，不做二级 tab**：顶部「统计与自动化」控制簇集中统计/自动化/AI 归因/AI 建议理由四开关与运行状态读数；其下**粘性子头**（`position: sticky`，钉在设置面板 `.choice-floating-body` 可视区顶部）含维度切换 + 快捷跳转 pills（`jumpTargets`/`jumpTo`，按当前可见分区动态列出，`scroll-margin-top` 抵消粘性头高度）；**概览**为可折叠分区（默认展开）合并 6 张汇总卡片 + 样本量分布诊断 + 趋势柱状图三块；条目榜升为主体紧随概览；命中榜 / 阵容计划 / 应用历史 / 管理为可折叠分区（组件内 ref 状态，默认折叠，切 tab 卸载即重置、不持久化）；条目榜分组**默认全部折叠**（无「有数据自动展开」），展开后组内容限高（360px）内部滚动（`overscroll-behavior: contain`），组头含「N 条建议」徽标（`groupSuggestCount`
  复用
  `suggestionOf`，仅可应用维度显示）；行建议可应用需条目被当前 config 引用（`EntryRankRow.referenced`）——留在 master_pool 但已不被引用的条目只显示洞察、不进入「应用全部」或行内对勾（写入目标不存在，避免批量应用计数虚高）；各区块大段说明收进区块标题旁 info 图标（原生
  `title` tooltip，触屏长按可见），区块内只保留一行读数式副标题（`choice-stats-sub`）； `--choice-bg-elevated`
  已在 theme.css 兼容映射区补定义（惰性引用
  `--choice-surface-2`，此前被 Statistics/DebugSettings 引用却未定义、行背景实际透明）。其下提供：6 张汇总卡片（生成/选择/选择率/活跃天数/池内参与率 /最近统计，均随维度；图标 chip 语义色区分 +
  `auto-fill minmax(150px)` 响应式列数）、样本量分布诊断（`entrySampleDistribution` 对照当前维度有效池： `entryMetrics`
  可评级——含冷却过滤、与建议引擎实际口径一致 = 样本充足 / 参与 >0 但不可评级 = 不足 / 池内从未参与 =
  never——此前 never 恒 0 的 bug 已修）、7/30 天趋势柱状图（纯 CSS，`dailySeries`
  随维度）、条目榜搜索/排序/「只看有数据」（`applyEntryFilters` 纯函数，组件只渲染；勾选持久化在
  `ui.stats_only_with_data`，切页/刷新不丢）、命中率/期望/近 10 轮窗口命中率读数与洞察徽标并入 meta 行（主行只留类型徽标 + 内容 + 右侧操作按钮，meta 行数字列 `tabular-nums` 对齐；洞察徽标由组件内 `buildInsightBadge` 单一映射文案/语义色/tooltip，模板不再散落 if/else）、洞察标签（`entryInsight`
  由 `entrySuggestion`
  派生：候选降权/建议停用/表现良好/样本不足/ 已停用（`effectiveEnabled=false`）/冷却中（调整后新数据不足）；
  **只提示不改权重**，需用户点行内对勾或「应用全部建议」经确认框写入，写入入持久撤销槽可撤销；组件侧 `rowMeta`
  每行一次性计算 suggestion+insight+badge 供标签/按钮/批量应用复用（`entryInsight`
  接受可选预计算 suggestion 参数），已停用条目行内另有「重新启用」就地恢复（`reEnableEntry`，置 config 引用 enabled=true，不记历史不刷冷却）、阵容计划区（`planRoster`
  派生：目标条数 N 输入 + 启用开关 + 在役/替补/未入池读数 + 落出/补入清单 + 一键应用经确认框写入，入 `apply_history`
  持久撤销槽；仅具体 config 维度显示）、应用历史面板（当前 config 维度的最近应用批次列表：类型徽标/相对时间/变更摘要/逐条撤销，
  `applyHistorySummary` 纯函数派生，随 `apply_history` 持久化、刷新不丢），「定位条目」操作闭环（行尾按钮 →
  `requestedTab`+`focusPoolEntryId` 信号 → 切 pool tab + 打开 `EntryPoolDialog`（master_pool 全量视图）+
  `getBoundingClientRect` 滚动 + 短暂高亮）、命中榜（用户选择的条目排行，`hitLeaderboard`
  纯函数）、导出 JSON（Blob 下载，同 EntryPoolDialog/PromptEditor 先例，含全维度 `entries`
  原始结构与当前维度条目榜 join 信息）与清空。按角色/chat 维度的上下文统计、全自动改权重/启闭功能本体均列为后续方向（半自动「建议 + 一键应用」与「阵容计划」已落地，阈值常量在 settings.ts 集中可调）。
  **AI 增强（可选，不参与动作判定）**：`ai_attribution_enabled`（默认关）开启后，`generateOptions` 成功路径异步入队 `enqueueAttributionAnalysis`（`src/core/ai-attribution.ts`，全局单飞串行 FIFO、fire-and-forget 不进关键路径；队列上限 `AI_ATTRIBUTION_QUEUE_MAX`=32，超出丢最旧不积压；**前置快检**：整轮选项均 type 前缀高置信命中（`allPrefixMatched`，`matchOptionToEntry` 返回 `{id, via}`）时直接跳过不发请求），后台调 AI 对「本轮选项 vs 候选条目」做语义归因，结果与生成时已实时记账的本地 Dice 归因 **diff 对称修正**（`reconcileAttribution` 纯函数：逐条目 Δmatched/count（count = `options.length` 实际保留条数，与记账同口径；勿用请求条数 `generation.count`，池下溢时分母错配致期望漂移）修正 expected_sum 与 `recent[gid].matched`；命中迁移仅当「旧归属条目该 gid matched==1 且已命中」——命中必来自被移走那条选项、无歧义，matched>1 不迁移宁缺勿错）；统计修正与消息写回**同进同出**（scope 已删/清空或 gid 已滚出窗口时两者都跳过，避免该轮期望保持 Dice、点击命中按 AI 的口径永久分裂），随后把 AI 结果写回消息 extra 覆盖 `options[].matchedEntryId`，并经 `setAttributionPanelRefreshHook`（panel-mount 注册 `panelStore.refreshFromMessageIfCurrent`）刷新面板持有的当前 generation 副本——避免点击读到旧 Dice、统计已按 AI 修正的口径分裂（同进同出设计的第三源缺口）。开关关/未配置 API/解析失败一律静默保留 Dice 结果；进度经模块级 `aiAttributionState` 可观测（队列/已修正/迁移，统计页 AI 增强块展示；running/totalRuns/lastError 原写而未读已删），后台重试走 `callSecondaryApiWithRetry` 的 `quiet` 参数不 toastr。`ai_analysis_enabled`（默认开）开启后，统计页打开/切维度/本维度有新数据时防抖 1s 触发 `runAiAnalysis`（`src/core/ai-analysis.ts`，单飞，可传 AbortSignal 取消、手动按钮旁有「取消」；`aiAnalysisState` 供进度/按钮态）——**失效判定按维度级 `ScopeStats.updated_at`**（跨维度活动不误触发；`runAiAnalysis`/`aiAnalysisNeeded` 均在 `collectSuggestionRows` 全量扫描前先按时间戳短路，无新活动直接返回，空建议维度也写「已看过」缓存避免每轮重扫），为当前维度 `entrySuggestion` 非 null 的条目（含提权，每批 ≤`AI_ANALYSIS_BATCH_SIZE`=20、上限 `AI_ANALYSIS_MAX_ENTRIES`=100 串行）生成自然语言理由，**增量复用仅限自动路径**（`suggestion_key` 指纹一致且已有理由的条目不重发请求，全部未变化只刷新失效时间戳；手动「AI 分析」按钮是 force 全量重跑——增量静默跳过会让点击无任何可见反馈，且无建议/无 API/全部失败时手动路径会 toastr 提示），指纹由 `suggestionKey` 纯函数按 action/目标权重/口径/超额/当前权重算出，结果缓存 `stats.ai_analysis[scope]`（`AiAnalysisScope`，随 `clearStats` 清空、`applySuggestions`/`applyRosterPlan`/`reEnableEntry` 清理受影响条目理由，`data_updated_at` 失效判定，手动「AI 分析」按钮强刷）；理由仅展示——组件侧 `aiReasonOf` 校验「当前建议指纹 === 缓存指纹」才显示（建议消失/变化即隐藏过期理由），低置信（<0.4）理由淡化，不改变建议动作、不写 config、不进撤销槽。两个开关都在 `GlobalSettings` 顶层（清空统计不清开关），沿用 active_api_id，老档由 zod default 补齐（含 `ScopeStats.updated_at`、`AiAnalysisEntry.suggestion_key`）；AI 统计字段本身未随其 bump SCHEMA_VERSION（zod default 兼容），v53 的 bump 是为 v52 旧默认提示词文本迁移（见 global-settings.ts），与 AI 字段无关。
- **生成模块是可排序、可启停的管线**：`prompt_rules.modules` 通过 `order`、`enabled`、`enrich_only`
  控制模块顺序和参与方式。上下文通过 `context_mode`
  等设置决定读取范围，不再维护“聊天内模式 / 全局模式”两套生成模式的说法。`enrich`
  模块必须排在 assistant 相关模块之前；人称和字数可配置，当前默认选项/润色范围为 10–60 个字符，不要把它写死成第三人称或 30–80 字。
- **认知边界（非全知）模块**：`knowledge_boundary`（`option_only`、默认启用、`order: 13.5` 浮点插值，排序在 `wi_depth_after`(13) 与 `core_rules`(14) 之间）。用于缓解“选项太过全知”（用了角色不该知道的信息 / 对看不到的事物做反应），内容独立成块声明“信息分层 / 禁止越界 / 逐条自检”，不改动 `core_rules`、`thinking_prompt` 等用户可编辑模块。开关 = 提示词编辑器里该模块的启用复选框；v59 迁移向 `prompt_rules.modules` 与各 `prompt_configs[].modules` 补建（仿 v24 reward_prompt 先例）。

## UI 设计系统与约定

### 当前视觉风格（现状快照，非约束）

以下仅记录当前实现的样子，供改版参考，**不是硬性设计规范**。重建/改版 UI 时以用户给出的示例为准，可直接推翻。

- 当前主视觉：`--choice-primary` 蓝色系 + `ActionOptionsPanel.vue` 版式（仅现状；可整体替换主色与版式）。
- 移动端优先：新组件先在约 380px 容器宽度验证，再扩展到桌面宽度。
- 当前走克制的卡片化、清晰层级、无玻璃拟态/强动效（仅现状；如你要求玻璃拟态或更强动效，照做即可）。
- **选项 HUD 化**（`ui.hud_enabled`，默认开）：**保留的行为不变量**——选项行本体（`.choice-option-btn`、`.choice-option-type`、`.choice-option-rate`、`.choice-roll-chip`）在 global.css 单一来源维护，主面板与悬浮球弹窗共用同一套规则（两处不再各自维护，避免判定/选中态行为漂移）；行内判定 chip 状态（选中打勾、判定结果显示与淡出）是组件内存态、不持久化；`prefers-reduced-motion` 下关闭动画。**当前视觉（可改，以用户示例为准）**——左缘 3px 风险档位色条（保守/平衡/大胆，当前惰性引用各主题语义色：保守=成功、平衡=info、大胆=警告）、`--choice-rate-*` 高/低档当前复用警告/成功、悬停加深浮起 + 色条加宽 + 行尾箭头、生成后逐条滑入（当前 staggered 60ms/条，v-for key 含 generation id 保证切代重放）、同代已选打勾（✓ + 半透明虚线）。
- **选项骰子判定**（v57 难度制，`GlobalSettings.dice`，`dice.enabled` 默认关）：AI 生成时在标题标注需求值（`[标题|档位|70]`，见 option-format 描述），未标注时按风险档位兜底（保守 35 / 平衡 60 / 大胆 85，`GRADE_FALLBACK_RATE` 放 option-format.ts 解析层）；点击选项时 `applyOptionBehavior` 掷 D100 判定（`rollDice`，`src/core/dice.ts`，判定序固定：roll ≥ `crit_success_min`（默认 96）大成功 → roll ≤ `crit_fail_max`（默认 5）大失败 → roll ≥ 需求值 成功 → 失败，彩蛋优先于成败且阈值交叉时彩蛋失效；**掷出 ≥ 需求值才算成功、点数越大越好**——v55「掷 ≤ 率 = 成功」概率制已废弃，用户直觉与正文 AI 均按高点数=成功理解）。**判定影响随所有点击行为生效**：成功/失败/大成功/大失败时 `buildDiceMarker` 把演绎指令包成 **HTML 注释**（`<!--...-->`，v57 起成功也注入；支持 `{rate}`/`{roll}`/`{margin}`/`{degree}` 占位符——`margin` = 点数−需求、`degree` = 口语化程度词（成功侧勉强得手/顺利达成/漂亮完胜、失败侧差点成功/事与愿违/彻底落败、彩蛋固定惊艳无比/灾难性失败，断点 ±33/±66 固定常量 `DEGREE_*` 放 dice.ts）。**v58 起成功/失败模板按程度档位拆分**：`success_/fail_send_{low,mid,high}_template` 各档独立演绎指令，`buildDiceMarker` 经 `degreeTierFor(outcome, margin)`（`src/core/dice.ts`，彩蛋返回 null 走单条）命中档位取模板，某档为空回退该结局单条回退文案（`success_template`/`fail_template`，铺到三档兜底）、两者皆空不注入；彩蛋 `crit_success/crit_fail` 各保持单条）拼入应用文本——send 直接发送（输入框只在发送瞬间短暂中转、发送失败/取消立即恢复纯正文），fill/insert/append 填入输入框（注释可见、可编辑删除，用户手动发送后 AI 同样读取，不拦截酒馆发送事件）；聊天界面默认隐藏注释、AI 请求原样携带。需求值徽标（`resolveOptionSuccessRate` 非 null 时显示，骰子开关开启即显示、独立于 HUD 开关；当前按需求高低分档着色 ≥70 橙 / 40-69 蓝 / <40 绿，高=难，v56 相对 v55 已反转配色，配色随改版可调）与行内判定 chip（**结局+差值**如「成功 +18」「惨败 −38」，差值=点数−需求带符号，行尾 absolute，3s 淡出滞留，组件内存态不持久化）同步在主面板与悬浮球实现；**判定结果不再弹酒馆 toastr**（v55 失败走 toastr.error 红得像插件报错，v56 起仅真实错误如「发送框不可用」才 toastr，判定只走行内 chip）。**判定战绩进 `stats.dice`（全局维度、不随 config；随 `stats_enabled` 采集，`recordDiceRoll` 关 = 早退零写入；仅计数不参与条目建议/权重/AI 分析；清空统计一并清除；不 bump schema_version——zod default/prefault 补齐）**，统计页「骰子战绩」折叠分区展示（总掷数/四档计数/胜率 `diceWinRate`/近 7 天判定次数）；`last_selected_text` 保持 parse 后原始正文不受注释污染。润色视图（`view='enrich'`）与无需求值选项（AI 自由发挥）不掷骰。**判定 chip 的组件内存态逻辑（rollResults/rollOf/fmtMargin/rollChipText，type RollResult）在主面板与悬浮球各自实现，属既定并行模式**（解析/判定/行为共享层在 option-format/option-action/dice，chip 状态是视图私有展示态），改动需两处同步，勿只改一处。
- `src/theme.css` 提供颜色、间距、字号、圆角、阴影、层级和状态色 token；间距用
  `--choice-space-1`~`--choice-space-6`，字号用 `--choice-text-xs/sm/base/lg/xl`（现状；新增样式可沿用，改版换体系亦可）。
- 当前层级 token 的实际值为：`--choice-z-panel: 10`、`--choice-z-floating: 30000`、`--choice-z-dialog: 30100`、`--choice-z-dropdown: 30200`、`--choice-z-popover: 30300`。（功能提示：遮罩/浮层 z 序需可预测，改版另立体系时请先与用户确认或复用现有 token，避免弹窗被遮。）

### Shared 组件现状与待办

`src/components/shared/` 已有
`ChoiceDialog.vue`、`ChoiceSwitch.vue`、`DragHandle.vue`、`ChoiceSectionCard.vue`（设置页**卡片式可折叠分组**：整块带边框卡片，标题行 + chevron + 右侧常显 `extra` 插槽 + 内容 slot。状态组件内 `ref` 不持久化、切子区卸载即重置；`inheritAttrs:false` + `$attrs` 落容器供 `data-tour` 锚点透传；**展开用 `v-show` 瞬时显示**（此前用 `grid-template-rows` 高度动画，用户反馈内容延迟露出，改 v-show 零延迟、内容始终挂载）、`prefers-reduced-motion` 下 chevron 无动画；卡片带轻微投影与 `--choice-border-strong`、标题图标恒用语义色点亮（`tone` prop，默认 `primary`，`danger` 走 `--choice-color-error`）、展开 chevron 转主色。生成页骰子判定/候选冗余/防重复/每条字数/人称视角、外观页主题/字体大小、调试页分区、API 页重试/渠道与模型、统计页折叠分区在用，已取代 `ChoiceDisclosure.vue`（后者已删除））、`ImportSourceDialog.vue`、`tab-definitions.ts`（两级导航定义：`PageId` 一级页 × `TabId` 子区）、`useCompactLayout.ts`、`ConfigBindings.vue`（条目池/提示词页共用的「已绑定角色卡」徽章行，含解绑）。其中
`useCompactLayout` 使用 `@vueuse/core` 的 `useElementSize`，断点为 420px；仍建议用 `useElementSize`
而非 CSS `@container`，因部分移动 WebView 可能静默忽略该规则。（`ChoiceSection.vue`/`ChoiceCard.vue`/`ChoiceField.vue`
三个曾作为设计系统预备的零引用组件已于死代码清理中删除，git 历史可回溯。）

**共享样式原子收在 `src/global.css`**（非 scoped，全局生效）：`.choice-check`（内联小复选框）、
`.choice-toggle`/`-custom`/`-label`（卡片式开关行，标题+描述+自定义复选框；原 Appearance/Generation 各
scoped 一份逐字重复，已收归此处）、`.choice-config-*`、`.choice-btn-sm`、`.choice-icon-btn`、
`.choice-section`/`-title`（**恒定展开的固定分组卡片**：带边框/圆角/内边距，与 `ChoiceSectionCard` 共用视觉语言，只在「是否可折叠」上区分）、`.choice-empty`（空状态邀请）等（现状收在此处）。新增设置页分区/开关/空状态复用这些原子即可，但这不是硬性要求——只有「≥2 处逐字相同」的块才值得提取，独有样式保留 scoped。
空态采用范围：条目池页（空池/无配置）与统计页条目榜/命中榜已用 `.choice-empty` 图标空态，其余页保持
`.choice-empty-hint` 纯文本提示。

目前只有 `ChoiceDialog` 在提示词导入等少数位置使用，其余设计系统组件仍是预备态，不能在文档中当作已经完成全量迁移。其余弹窗仍可能保留独立 overlay/header/footer 样式；迁移时要逐个验证遮罩关闭、Escape 关闭、动画和窄屏布局，不要一次性假设全部组件已经统一。

### 悬浮球实际状态

`FloatingBubble.vue` 当前实现的互斥状态是 `Disabled > Generating > Dragging > Idle`：

- Disabled：API 解析失败或 `effectivePool` 为空。
- Generating：`generatorState.loading === true`。
- Dragging：拖动期间展示拖拽态。
- Idle：默认态；已经实现贴边吸附和边界钳制。

右键菜单是当前快捷菜单入口（右键/触屏长按 500ms 呼出，含「查看行动选项 / 打开设置 / 隐藏悬浮球」，与选项 popover 互斥）；尚未实现基于
`onLongPress` 的长按状态机。 **左键点击气泡行为由 `ui.bubble_click_action` 控制**：`options` = 切换选项弹窗、 `settings`
= 打开/关闭设置面板。选项弹窗（`FloatingOptions.vue`）是**独立 UI**，不复用 `ActionOptionsPanel`
的版式：无标题栏、纯列表紧凑排版、底部工具条（分页/生成/锁/设置/条件显示的档位图例）；选项解析（`src/util/option-format.ts`）与行为应用（`src/util/option-action.ts`）是与主面板共用的共享层，弹窗内禁止再写一份解析/行为逻辑。弹窗锁读写**独立字段 `floating_options_lock`**（`off ↔ open`
二态，与聊天面板的 `panel_lock` 解耦，互不同步——面板锁管展开/收起自动化、弹窗锁只问「点选项后收不收起」），锁定时**弹窗常开**：点选项、点弹窗外部、Esc 均不关闭；仅支持 hover 的鼠标移出选项栏时弹窗**淡化**（`dimmed`
态 opacity 0.45，移入恢复），淡化开关为工具条锁右侧的 `floating_dim_enabled`（默认开，仅锁定 +
hover 设备显示）；触屏不淡化；只能解锁或点击悬浮球开关收起；点工具条「设置」为例外仍关闭弹窗并打开设置面板。
`chat_panel_enabled=false`
时主面板整组隐藏且润色按钮隐藏，但 store 数据同步与自动生成照常运行（弹窗读同一 panelStore）。popover 状态
`isBubbleOptionsOpen` / `closeBubbleOptions` 位于
`floating-state.ts`，设置面板打开时自动收起。`hasUnseenResult`、未读结果徽章和快速预览 popover 尚未接入。

**悬浮球样式**：`ui.bubble_style`（`ring` / `compact`，AppearanceSettings「悬浮窗」分区选择）。直径单一来源是 `floating-state.ts`
的 `bubbleSizeFor(style, isMobile)`：`ring` 桌面 60 / 手机 48；`compact` 桌面 48 / 手机 40（手机更小、更不遮挡），
`bubbleSize` computed 读 store 惰性求值、`bubbleX/Y` 模块级初值用纯函数 `defaultBubbleSize()`（模块加载时 pinia 未就绪，不得读 store）。
compact 档在 FloatingBubble 只削弱内环保留度/放慢呼吸（`.choice-floating-bubble--compact`），尺寸统一由 bubbleSize 驱动。

**入口保底护栏**（`src/core/entry-points.ts`）：悬浮球 / 魔棒菜单 / 聊天面板三个可视化入口，`setEntryVisible(key, on)`
在关闭「最后一个开着入口」时拒绝并 toastr 提示，保证插件不会因用户全关而无从找回。外观页三个入口 checkbox 与悬浮球右键菜单
「隐藏悬浮球」必须走 `setEntryVisible`，禁止组件直接写 `ui.floating_enabled` 等字段绕过保底；新增入口维度需同步 `EntryKey`。

### 面板工具区与魔棒菜单入口

- `ActionOptionsPanel.vue` 标题栏工具区右起为 [生成/润色][锁定][主题循环][设置]：设置按钮复用
  `openSettings`（`floating-state.ts`），与悬浮球/魔棒菜单共用同一开关。
- `wand-menu.ts` 向酒馆输入框左侧的 `#extensionsMenu`
  注入「行动选项」入口，点击打开设置面板。`ui.wand_menu_enabled`（AppearanceSettings「聊天界面」分区开关，默认
  `true`，schema `src/type/settings.ts`）控制该入口显隐，通过全局设置 `$subscribe`
  即时同步；该开关只影响魔棒入口，不联动 `floating_enabled`、不影响选项面板/悬浮窗。
- 聊天选项面板支持 `ui.panel_collapse_on_outside_click`（默认关）：开启后仅当点击命中聊天区 `#chat` 内的普通正文/空白处收起，链接/按钮/输入框/工具栏等交互目标排除、不反向点击展开（**不排除 .mes 本体**，手机端整屏文字也可触发收起）；触发范围收窄到 `#chat` 内——点其他插件浮动面板（DOM 多在 `#chat` 外）不收起、也不吞其点击，避免误伤。
- 面板正文有独立字号 `ui.option_font_size` + `ui.option_font_size_auto`（只乘聊天面板选项文字，不影响悬浮 popover）。
- **调整模式**（ActionOptionsPanel 组件内存态 `adjusting`，不持久化）：标题栏「调整」按钮（`fa-sliders`，位于设置入口左侧，不占用生成/锁定/主题的高频位置）进入，调整态下选项与行为栏禁用，仅显示标题栏下方的调整工具条——左端大触摸高度拖动区（pointer drag 实时写 `ui.option_panel_height`，0=自动 45/40dvh 上限、上限对齐 schema 的 1000）+ 右端字号档（自动/小/中/大，写 `ui.option_font_size`）。外观页不再提供「选项面板字号」段，字号唯一入口在调整态。**调整态面板临时绝对定位、底部锚定**（进入时父容器 `#choice-panel-mount` 置 `position:relative` + 保留面板原高，面板 `position:absolute; bottom:0` 铺满宽度）：面板增高时顶部向上抬升（**往上长**）、底部与输入框不动，拖动把手随光标走——公式 `option_panel_height = resizeStartH - (clientY - resizeStartY)`，向上拖变高、向下拖变矮。**点击面板外任意处 = 完成调整**（退出调整模式，与「点击聊天正文收起」开关无关），退出时仅还原父容器样式，不做任何滚动跳转，面板保留在原处。
- **设置面板导航为两级结构**（`FloatingSettings.vue` + `shared/tab-definitions.ts`）：
  一级 4 个胶囊页（内容/生成/统计/系统）+ 页内二级子 tab 条（分段控件）。
  子区 id 沿用旧 `TabId`（pool/generation/prompt/api/worldinfo/filter/stats/appearance/debug），
  引导 `PAGE_HINTS`、信号 `requestedTab`/`onboardingPendingTab`、`OnboardingStep.tab`
  全部以子区 id 为键（未变）。某页可见子区≤1（stats 恒 1；简化模式下 content/system 各剩 1）时
  子 tab 条自动隐藏、直接展示该编辑器。🎓（章节菜单）/❓（当前子区指引）按钮在**题首**
  （不在导航条内），❓ 键取 `PAGE_HINTS[activeSubArea]`。信号 `requestedTab`/`onboardingPendingTab`
  经 `goToSubArea(id)` 同步 page+subArea 两级。**简化模式语义**：`advanced_features_enabled=false`
  从「隐藏整 tab」改为「隐藏高级子区」（content 隐 prompt/worldinfo/filter、system 隐 debug），
  开关仍在 appearance 子区（基础层始终可达）；守卫 watch 在 activeSubArea 落入隐藏子区时弹回当前页首个基础子区。
  窗口模型仍为自由拖拽/可缩放浮窗（未改）。**UI 去杂乱第一期（骨架）**已落地：导航重组 + 原子整合。
  **第二期（开关折叠 + 措辞 + 空状态）**已落地：生成页「骰子判定/候选冗余/防重复/每条字数/人称视角」收进
  `ChoiceSectionCard` 卡片式折叠分组（骰子总开关与防重复启用开关常显在标题行右侧 `extra` slot；折叠状态组件内
  ref 不持久化、默认收起；`data-tour="gen-dice"` 经 `$attrs` 留在容器锚点）；`PAGE_HINTS`/引导文案「tab
  栏/设置页」过时措辞已改为「题首/子区」；条目池页与统计页条目榜/命中榜空态升级为 `.choice-empty` 图标空态。
  `data-tour` 锚点重指无需再做（一期已核实全部 target 指向编辑器内部锚点、无指向 tab-strip）。
  **第三期（卡片化去杂乱）**已落地：页内平铺控件统一收进「带边框卡片 + 标题行」分组。新增
  `ChoiceSectionCard.vue` 可折叠分组组件（默认折叠、`grid-template-rows` 动画）、`.choice-section`
  升级为恒定展开的固定分组卡片（与 `ChoiceSectionCard` 共用视觉、仅「是否可折叠」区分）。生成页拆为
  基础行为/点击行为/生成数量/骰子判定/候选冗余/防重复/每条字数/人称视角 8 组，外观页主题/字体大小、
   调试页分区、API 页重试/渠道与模型均改卡片；内容页高级子页（提示词/过滤）套固定 `.choice-section`
   卡片外壳（上下文设置/提示词配置/模块列表、过滤设置/标签提取/
    全局与预设与角色卡正则区）；世界书页「设置」与「已启用的世界书」为固定 `.choice-section`（恒展开常驻，
    已启用紧跟设置，标题带条数），「全局排除」与「未启用的世界书」为可折叠 `ChoiceSectionCard`
    （默认折叠）；「已启用的世界书」内每本书的条目折叠保留在区块内容体，**本扩展显式启用（在
    `enabled_books`）的行带「移除」按钮**（`disableBook` 只从 `enabled_books` 删、不动 mods/overrides），
    ST 全局/角色/聊天激活书不显示移除按钮；「未启用的世界书」与「全局排除」一样带搜索框 + 限高滚动列表
    （`inactiveSearch`/`filteredInactiveBooks`，仅展示过滤、不写 store），无刷新列表按钮
    （`refreshAll` 经 onMounted/onActivated/CHAT_CHANGED 自动加载），条目池为列表工具页未改。
  折叠态为组件内 ref 不持久化；未改任何 store/schema/生成逻辑。
  **卡片精修**已落地：卡片加轻微投影与 `--choice-border-strong`、标题图标恒用语义色点亮（新增 `tone`
  prop，`danger` 走红色）、展开 chevron 转主色；折叠默认态统一（生成页仅「基础行为」展开、其余全部默认折叠；
  调试页「危险操作」`default-open` 保证重置按钮可见、「版本信息」恒展开固定卡；外观页仅「高级功能」固定、
  悬浮窗/聊天界面/主题/字体大小 可折叠；API URL 输入框补 `flex:1` 与其他栏等宽）。
  **卡片展开瞬时化 + 统计页卡片迁移**已落地：`ChoiceSectionCard` 折叠体改 `v-show` 瞬时显示（去掉高度动画，
  消除展开内容延迟露出的反馈）；统计页各区块统一迁移到卡片体系——可折叠分区（条目榜（默认折叠）/骰子战绩/阵容计划/应用历史/
  命中榜/管理）用 `ChoiceSectionCard`、恒展开分区（统计与自动化控制簇、概览）用固定 `.choice-section`（概览按用户要求恒展开、条目榜按用户要求可折叠且默认折叠），
  锚点经 `$attrs` 落到卡片根（`scroll-margin-top` 挂 `.choice-section-card[data-anchor]`/`.choice-section[data-anchor]`），
  原本地 `show*` 折叠 refs 与旧 `.choice-stats-section-*` 头部样式已删；粘性子头**跳转 pills 已移除**（按用户要求删掉跳转按钮），
  维度切换/撤消/apply 流保留。统计页内部仪表盘（汇总卡/趋势/条目榜表/拆单/Dim/apply 流）与数据口径未动。
  卡片标题行 hover 整行高亮（含右侧 extra 区）。

## 目录与职责（按当前源码，不把早期规划稿当标准）

- `src/core/`：`generator.ts`（结构化 role
  prompt、选项/条目池生成、取消、API 解析）、`pool-resolver.ts`（effectivePool 的分组加权抽取纯函数）、`option-dedup.ts`（候选选项去重）、`options-store.ts`（消息 extra、swipe、翻页和润色结果）、`stats.ts`（行动选项统计：scope 化记录、全局聚合视图、建议引擎与撤销、AI 归因对称修正 reconcileAttribution、骰子战绩 recordDiceRoll/diceWinRate）、`ai-attribution.ts`（L1 AI 归因异步队列：入队（含前缀快检/队列上限）/prompt/解析/统计修正/消息写回/状态暴露）、`ai-analysis.ts`（L2 AI 建议理由：维度级失效判定/增量复用指纹/单飞分批分析/取消/进度状态/缓存写入）、`dice.ts`（v57/v58 骰子判定：D100 rollDice、隐形演绎注释渲染 buildDiceMarker、程度档位模板）、`floating-state.ts`、`entry-points.ts`、`enrich-input.ts`、`api-client.ts`、`panel-mount.ts`、`theme-detector.ts`、`theme-presets.ts`、`wand-menu.ts`、`onboarding.ts`、`guide-content.ts`、`bindings.ts`（配置绑定切换：聊天级/角色卡级，PoolEditor/PromptEditor 共用）、`constants.ts`（跨模块共享的分组语义/展示占位常量），以及
  `baibai-bridge.ts`、`ejs-bridge.ts`、`shujuku-bridge.ts`、`st-character.ts`、`st-regex-source.ts`
  等可选桥接和酒馆数据适配模块。
- `src/store/`：`global-settings.ts`、`character-settings.ts`、`chat-settings.ts`、`pool-selector.ts`、`prompt-config-selector.ts`、`panel-state.ts`。设置 schema 的唯一来源是
  `src/type/settings.ts`，当前 `SCHEMA_VERSION` 为 59。
- `src/components/`：主面板 `ActionOptionsPanel.vue`；悬浮形态
  `FloatingBubble.vue`、`FloatingRoot.vue`、`FloatingSettings.vue`、`FloatingContextMenu.vue`、`FloatingOptions.vue`；9 个设置编辑器（作为二级子区挂在 4 个一级页下：内容=条目池/提示词/世界书/过滤、生成=生成/API、统计=统计、系统=外观/调试）`PoolEditor.vue`、`GenerationSettings.vue`、`PromptEditor.vue`、`ApiEditor.vue`、`WorldInfoEditor.vue`、`FilterEditor.vue`、`Statistics.vue`、`AppearanceSettings.vue`、`DebugSettings.vue`；条目池和导入相关组件：`EntryPoolDialog.vue`、`PoolGenDialog.vue`、`SelectEntriesDialog.vue`、`ImportPoolDialog.vue`、`PromptImportDialog.vue`、`StRegexImportDialog.vue`、`FilterGroupPanel.vue`；引导相关组件：`OnboardingWizard.vue`、`WelcomeCard.vue`、`GuidePopover.vue`；通用弹窗包括
  `ConfirmDialog.vue`、`CreateConfigDialog.vue`、`RegexLibraryDialog.vue`。
- `src/components/shared/`：设计系统基础组件、拖拽手柄、导入来源弹窗、tab 定义、窄屏布局 composable 与 `useConfirm.ts`（确认弹窗 Promise 化封装，Statistics 清空/应用建议/应用阵容三处使用）。
- `src/type/`：Zod schema、默认值、迁移逻辑和领域类型；不要在组件里重新定义设置结构。
- `src/util/`：文件选择、SortableJS 配置、Zod 解析辅助、时间格式化（`time.ts`）与条目展示摘要（`entry-preview.ts`）；选项文本解析（`option-format.ts`：`parseOptionType`/`parseOptionContent`/`parseOptionStyle`/`parseOptionRate`/`resolveOptionSuccessRate`，风险档位分级与需求值标注共享同一拆分——`[标题|保守/平衡/大胆]`、`[标题|大胆|70]` 竖线标注，任一段既非受控档位词又非需求值数字则整段回退当标题，词表外/无标注返回 null 中性显示，需求值未标注时按 `GRADE_FALLBACK_RATE` 档位兜底（难度制：掷 ≥ 需求值=成功，越大越难），受控词表与 prompt core_rules 输出格式同步）与点击行为应用（`option-action.ts`）是主面板与悬浮球弹窗共用的共享层；`character-bindings.ts`
  提供角色卡绑定扫描（`getBoundCharacters`）与可靠持久化（`persistCharacter`，直接 POST
  `/api/characters/edit`，替代会丢扩展字段的 `saveCharacterDebounced`）。
- 根级入口包括 `src/index.ts`、`src/pinia.ts`、`src/theme.css`、`src/global.css` 和全局类型声明。

## 新手引导架构

- 内容单一来源是 `src/core/guide-content.ts`：`GUIDE_CHAPTERS`（7 章）+ `PAGE_HINTS`（9 个子区，键=子区 id 未变）+
  `DIALOG_HINTS`（3 个弹窗）。组件中不要另写平行的引导文案。
- `quick-start` 是唯一默认路径（配置 API → 生成），另有条目池、生成、提示词、世界书、过滤、外观 6 个进阶章。章内使用
  `onboardingStepIndex`，当前章由 computed 解析。
- `onboarding.ts`
  负责自动打开、欢迎卡、API 配置召回、章节菜单、待处理 tab/弹窗动作等状态。自动生成路径遇 API 未配置时只提示并跳过，不抢焦点弹窗。
- 设置面板**题首**的 🎓 打开章节菜单，❓ 显示结构化 `PAGE_HINTS`（键取当前子区 `activeSubArea`）；页内指引必须结构化渲染。唯一受控的
  `v-html` 例外是 `OnboardingWizard` 的步骤富文本（`GUIDE_CHAPTERS[].html`）：内容 100% 来自
  `guide-content.ts` 编译期静态脚本，无用户输入/无插值/无运行时拼接，组件内该处带显式 lint 豁免注释；
  不要把用户可控数据传进 `step.html`，新增引导文案优先走结构化字段。
- `onboarding_done` 在欢迎卡或向导弹出时即置为 true。`data-tour`
  锚点分散在 13 个组件模板中，增删向导步骤时要同步检查锚点。
- `docs/` 下已无提示词设计参考文档；不要引用不存在的
  `choice-prompt-redesign-spec.md`、`async-action-options-spec.md`、`choice-ui-redesign-spec.md` 或
  `choice-floating-bubble-design.md`。当前源码是唯一标准。

## 条目池模型与抽取算法

- `PoolEntry` 字段为 `id`、`type`、`content`、`rule`、`pinned`、`weight`、`category`；`pinned`/`weight` 可被
  `PoolConfigEntry` 覆盖。`rule` 是写作约束，不是选用门槛；v20 起删除
  `condition`，v21 起候选条目必须交给 AI，`[规则: xxx]` 只约束该选项如何写。
- **配置级规则/示例（单一自由文本，按配置绑定）**：`PoolConfig` 只有单一自由文本字段 `rules`（`examples` 已删除）；
  无条目级字段，条目档位规则写在已有 `rule` 里。生成选项时（仅选项路径，润色不注入），`generator.ts` 的
  `buildConfigRuleText` 纯函数返回生效 config 的 `rules` 原文（trim；空串返回 `''` 不注入，通用行为零变化），
  **内联进候选文本**、拼在 `{{pool_selected}}` 展开值的末尾——**不加任何标签/小节标题**，用户自行组织内容，
  随 option_task 的 user 消息一起发出（不新增消息、不改 buildMessages 消息序列、不破坏原有提示词结构）。
  UI 入口：PoolEditor 配置区单个「规则（可选）」输入框。导出/导入整对象序列化，字段自动携带。
- **选项输出契约（JSON 主路径 + 括号回退）**：AI 生成行动选项时（仅选项路径），prompt 要求把候选输出成
  `<options>` 内的 JSON 数组（元素 `{"title":"标题|档位|需求值","content":"正文"}`）。`parseOptions` 以
  JSON 为主路径：`parseJsonOptionArray` 解析后重建 `[title]content` 字符串并返回 `string[]`（与旧档同构），
  content 由 JSON 结构读出、可含任意字符（含 `[]`/`【】`/换行）而绝不切分——这正是让配置级 `rules` 里用户写的
  `[]`/`【】` 内容在选项正文中绝对安全（不切碎、不丢正文）的机制；解析失败回退到原有 `[标题]内容` 括号启发式
  （含 `【标题】` 容错、run-on 恢复、`标题: 内容` 行级），旧提示词快照/老模型照旧。奖励标记
  （`【系统奖励：…】`等）是内容不是结构。display/归因/去重均走 `^` 锚定解析、只剥首标题，故重建字符串中
  内容侧括号天然安全；输出契约改动不影响读消息里的存量选项。
- 抽取顺序：解析 effectivePool
  → 拆分固定/非固定并处理固定条目溢出 → 按 category 分组并处理下溢 → 分组轮询、组内按 Efraimidis–Spirakis 加权无放回抽取 → 按
  `oversamplePct` 为非固定条目补充菜单候选 → 送入 prompt 前整体 shuffle。加权 key 为 `random()^(1/weight)`；具体实现以
  `src/core/pool-resolver.ts` 为准。
- `cross_layer_fallback` 已删除，不要重新引入或在新代码中保留该兼容概念。抽取默认值和 schema 以 `src/type/settings.ts`
  为准。
- 选项去重在 `src/core/option-dedup.ts` 完成，使用相似度阈值和去重报告；调试信息由 `DebugSettings.vue` 展示。

## 构建、格式化与验证

```bash
pnpm install
pnpm build             # 一次性 production 构建
pnpm typecheck         # 类型检查（等价 npx vue-tsc --noEmit）
pnpm lint              # ESLint 检查
pnpm format            # Prettier 写回格式
npx knip               # 死代码扫描（未用导出/文件/依赖；klona/pinia/toastr 因 unplugin-auto-import
                       # 与酒馆全局注入列入 knip.json ignoreDependencies，勿手动移除）
```

当前没有 Vitest/Jest 测试脚本；验证手段是类型检查、构建、lint/format 和按改动范围进行的浏览器验证。`pnpm watch`
是常驻的 development
build，不要由 agent 启动。watch 会使用内联 sourcemap，可能覆盖本地 production 产物；这是正常的开发状态。远程 GitHub
action 会在发布分支执行 production bundle 并提交 `[bot] Bundle`，提交时不要为了 map 或 CSS 产物状态额外重跑发布流程。

浏览器验证使用当前工作区可用的浏览器自动化工具和用户已有酒馆登录态；不要在仓库文档中假定某个平台的 Chrome 启动命令、MCP 注册方式或新开无痕实例。验证 UI 时至少确认：核心交互链路可操作、窄屏不横向溢出、console 没有新增 Vue/Pinia 报错。改动悬浮球、ActionOptionsPanel、弹窗或响应式布局时，按实际改动场景逐项操作，不要把尚未实现的未读结果态列为通过条件。

## 分支纪律（防三分支选项代码漂移）

- `main` 是发布线，只从 `test` 同步源码；dist 由 bot bundle 管理。
- `test` 是行动选项 bug fix 和预发布验证主战场。
- `feat/passive-status` 只做被动状态，成熟前不合并回 main/test；定期 rebase `origin/main` 获取 bug fix。
- 行动选项 bug fix 只在 `test` 修并推送验证。
- 大版本发布（test 领先 main 较多、含多个功能批次时）：`test → main` 用
  `git merge test --no-ff -X theirs`（源码冲突一律取 test 侧），合并后 `git restore --source=<merge 前 main sha> dist`
  恢复 main 侧 dist，让 bot 重出产物；merge 提交信息带 `[release minor]`/`[release patch]`/`[release major]`
  标记，由 bundle CI 自动 bump `manifest.json`/`package.json` 并打 tag（机制见
  `.github/workflows/bundle.yaml`，不要手动改版本号）。
- 增量 bugfix 的 `test → main` 同步使用
  `git cherry-pick -n <sha>`，只搬源码不搬 dist；发生 dist 冲突时保留 main 侧 dist，让 bot 重出产物。
- `feat` rebase 时保留 main 的 fail-safe 与 feat 的被动状态；rebase 中 `ours`
  是新 base（main）一侧，dist 使用 main 侧；feat 不触发 bot bundle。
- 除 bot
  bundle 外，默认分支还有定期依赖更新 action，可能造成 main 与 test 的依赖版本漂移；同步前先检查远端 main 的最新提交。
- `--ours/--theirs` 方向：cherry-pick 中 theirs 是被 pick 的提交；rebase 中 ours 是新 base（main）。

## 实现前必须核实的酒馆接口

- `TavernHelper`、`generateQuietPrompt`、`generateRaw` 的当前签名及是否支持 `AbortSignal`。
- `#send_textarea`、`#send_but` 等发送框 DOM id 是否与目标酒馆版本一致。
- `character.data.extensions` 命名空间的真实读写 API。
- `/api/characters/edit` 的 form-data 契约：`json_data` 必须是角色完整卡 JSON（`ch.json_data` 原始快照，形如
  `{ spec, name, data: {...} }`），不能传 `ch.data` 子对象——后端 `charaFormatData` 会把它当顶层结构重建，扩展字段会脱离
  `data.extensions` 而被读卡器丢弃。
- 当前 `TavernHelper` 的实际导出面，以真实源码和类型定义为准，不要根据旧文档猜函数名。
- 当前锁定版本 `@vueuse/core ^13.9.0` 中 `useElementSize`、`onLongPress`
  的签名和触摸滚动边界行为；未实现的长按方案在重新设计前不要直接照抄旧示例。
