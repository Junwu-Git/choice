# choice 提示词与条目池深入检查报告（2026-09-09）

检查范围：提示词（模块化内容/配置选择/迁移/注入管线/编辑器）与条目池（`master_pool + configs` 两层结构/抽取算法/迁移/编辑器）两块的**内容与代码**。
检查方式：静态源码审查 + 关键疑点浏览器实测（本地酒馆 1.18.0 `8172dcd0e`）。**只读检查，未改动任何源码。**

---

## 结论摘要（按严重级排序）

| # | 严重级 | 结论 | 对应项 |
|---|--------|------|--------|
| 1 | 中 | 提示词模块编辑存在「快照不同步」路径，特定操作组合下编辑会丢失 | A1 |
| 2 | 中 | 运行时生效提示词 = 工作副本（`prompt_rules.modules`），与「聊天/角色绑定提示词配置」的生效语义脱节；多配置/切聊天场景下绑定可能不生效 | A2 |
| 3 | 低（文档） | v44 迁移注释与 `docs/choice-prompt-redesign-spec.md` 声称存在 `opt_*` 六个可选规则模块，实际未实现 | A3/A6 |
| 4 | 低（文档） | spec §3.1「事实基线」多处过时（core_rules 拼装、模块数、可选模块） | A6 |
| 5 | 低（代码异味） | `generator.ts:881-882` 死值 `minChars:30/maxChars:80`；`migratePromptModules` 内 `<37` 的 `shujuku_enabled` 初始化位置错位 | A4/C1 |
| 6 | 低（观察点） | `buildMessages` 相邻同 role 合并可能把历史末条 user 与 `option_task` 合并；未实测（API 未连接） | A5 |
| 7 | 低（观察点） | 去重 refill 的剔除比例分母用首轮 `parsed.length`，非本批比例 | C3 |
| 8 | 无 | 条目池抽取算法、effectivePool 解析、v46 迁移、编辑/导入均核实正常；v44/v46 大改实现在 c4352d9 一个提交内 | B/C5 |

以下各节给出逐项证据与修复建议。

---

## 1. 提示词侧检查明细

### A1 【中】提示词模块编辑存在「快照不同步」路径

**现状**：所有模块编辑（启用开关 `PromptEditor.vue:722-724`、内容 textarea `:328`、重命名、排序）直接改写工作副本 `prompt_rules.modules`，**不触发** `syncPromptRulesToConfig` 回写配置快照。`syncPromptRulesToConfig` 仅有 4 个调用方：`resetModuleOrder`（`global-settings.ts:2129`）、`switchPromptConfig` 离开时（`:2196`）、`importPromptModules`（`:2280`）。落盘 watcher（`:1796-1808`）只写 `prompt_rules`，不写 `prompt_configs[].modules`。

**浏览器实测**（关键，推翻初始「刷新即丢失」的静态误判）：
1. 编辑「应答声明」内容 → 工作副本变为测试内容、配置快照保持默认（`workEqualConfig:false`）——确认编辑不同步快照。
2. 刷新页面 → 工作副本保留测试内容（watcher 已落盘），配置快照仍默认。
3. 重新打开设置→提示词页 → **工作副本仍保留测试内容，未被快照覆盖**。

原因：`PromptEditor.vue:457-469` 的 `watch([promptConfigs, effectiveConfig], { immediate: true })` 在挂载时把 `selectedPromptConfigId` 从 null 置为生效配置 id，但 `watch(selectedPromptConfigId)`（`:475-483`）在其后注册，首次同步赋值不会触发回调，因此首次打开不会走 `switchPromptConfig`，也就不会 `loadPromptConfig` 覆盖工作副本。`switchPromptConfig` 仅在用户**显式**切换下拉时执行。

**残留真实风险（中）**：编辑后刷新，工作副本 ≠ 配置快照。此后用户若显式切换提示词配置下拉（切走再切回、或切到任一配置再切回），`switchPromptConfig → loadPromptConfig` 会用**旧快照**无条件覆盖工作副本，未回写的编辑即丢失。即「编辑 → 刷新 → 之后再切一次配置」组合才会丢。
（验证步骤可复现：编辑模块→刷新→在下拉中切到另一配置再切回→内容还原。）

**修复建议**：
- 首选：在 PromptEditor 编辑动作后立即 `syncPromptRulesToConfig(selectedConfig)`（或对模块编辑加一个 store 内轻量回写），使工作副本与当前归属配置快照保持同步；此修复与现有 `promptEditConfigId` 归属逻辑天然契合。
- 备选：`loadPromptConfig` 前做一致性检查，仅当工作副本与目标快照逐模块一致时才覆盖（改动面大，不推荐）。
- 需回归：配置切换回写链路（`switchPromptConfig`）、导入落盘（`importPromptModules`）、`resetModuleOrder` 回写。

### A2 【中】运行时生效提示词与绑定配置语义脱节

**现状**：
- 生成链路只用 `gs.sortedEnabledModules`（`global-settings.ts:1840-1842`，来源 `prompt_rules.modules`）——`generator.ts:890`、`enrich-input.ts:41`。
- `prompt-config-selector.effectiveConfig`（`prompt-config-selector.ts:11-21`，chat > character > default 解析）**只在 `PromptEditor.vue` 展示「当前生效」名称时被读取**，生成链路不消费。
- `index.ts` boot 不把绑定配置加载进工作副本；v44 迁移仅在删除全向配置时把工作副本重置为 `DEFAULT_MODULES`（`global-settings.ts:1478`）。
- PromptEditor 挂载后，`selectedPromptConfigId` 只在「无效/为空」时重置（`PromptEditor.vue:464`）；切换聊天/角色后绑定变化，已挂载的 PromptEditor 不会自动把新生效配置加载进工作副本。

**结论**：与 AGENTS.md「提示词配置覆盖式选择 `chat > character > default`」的表述不一致。实际语义是「工作副本优先、配置快照只是编辑器读写对象」。单配置场景无差异；多配置 + 绑定场景下，绑定配置要「打开过提示词页且选中它」才落到工作副本，切换聊天后不会自动跟随。

**修复建议**（需产品决策，三选一）：
1. 维持现状，把 AGENTS.md 的表述改为「运行时使用工作副本；配置绑定仅在提示词页加载时生效」——零代码改动，文档对齐。
2. boot / `CHAT_CHANGED` / `CHARACTER_PAGE_LOADED` 时按 `effectiveConfig` 加载工作副本（幂等、不覆盖用户未回写编辑的前提下）——行为向文档收敛。
3. 生成链路直读 `effectiveConfig` 的模块（改动最大，需处理「编辑器编辑未回写快照」的一致性问题）。

### A3 【低/文档】v44 注释声称补建 opt_* 六模块，实际未实现

`global-settings.ts:1443` 注释「②' 补建六个内置可选规则模块 opt_*（默认关）」，`v44` 块（`:1447-1572`）实际只有：① 删全向三件套+喵可组 ② 删 `user_instruction/output_spec/reward_prompt` ③ 内容中性化 ③' 改名 ④ order 对齐，**无 opt_* 补建代码**。全仓 grep `opt_` 仅注释命中。`docs/choice-prompt-redesign-spec.md:172` 亦声称「6 个可选规则模块 order 15.1~15.6 默认全关」。

**结论**：注释与 spec 超前于实现（P1/P2 设计未落地）。修复建议：删除/改写 v44 注释中 opt_* 表述，或在 spec §3.1 明确标注「规划中未实现」。

### A4 【低/代码异味】`generator.ts:881-882` 死值

```ts
minChars: 30,
maxChars: 80,
```
generateOptions 构造 Ctx 时的占位值，随后被 `buildMessages` 的 augmentedCtx（`generator.ts:161-169`，按 `prompt_rules.option_min/max_chars`）覆盖，永不生效。建议改为从 `rules.option_min_chars/max_chars` 取值（消除误导），或删除两行。

### A5 【低/观察点】buildMessages 相邻同 role 合并

`generator.ts:286-295` 把相邻同 role 消息用 `\n\n` 合并。若聊天历史末条是 user 消息且 `wi_depth_after` 无内容（无 D0-D2 世界书条目），`option_task`（role user）会与历史末条 user 合并成一条。语义上任务指令仍可辨认，但存在被模型误读为历史正文的风险。**未实测**（本机酒馆 API 未连接，无法实际生成；DebugSettings `lastBuildMessages` 需生成后才填充）。修复建议：合并时对 `option_task` 与历史之间插入 role 分隔（如把 option_task 保持独立，或在合并循环里跳过跨模块合并）。

### A6 【低/文档】`docs/choice-prompt-redesign-spec.md` §3.1 事实基线过时

- §3.1 称 core_rules 是「option_rules + person_style + CORE_RULES_STATIC 三段拼装」——现状已是「直接发模块 content」（`generator.ts:259-266`，注释明确该拼装路径已删除）。
- 称「单套 30 模块」——现状 JSON 24 模块（UI 显示 22，过滤掉 `baibai_state` 与关闭的 `baibai_summary`）。
- 称「6 个可选规则模块 order 15.1~15.6」——不存在（见 A3）。
- 称 PromptConfig「切换只同步 `{modules, person_style, option_rules}` 三字段」——v44 起 `copyPromptRulesSubset` 已收窄为 `{modules}`（`global-settings.ts:1686-1689`）。

修复建议：spec §3 标注「截至 2026-09-09 的现状快照」，按上述四点修订；§5/§6 的插槽、opt_* 设计标注「规划中（P2），未实现」。

### A7 【无问题】提示词默认内容一致性

- `choice-prompts-optimized.json` 无 `{{prev_options}}` 残留；`sub()`（`generator.ts:149`）保留该占位符仅为兼容自定义模块，DebugSettings 已标注「默认提示词已不使用」（`DebugSettings.vue:104`）。
- `OPTION_TASK_DEFAULT`（`settings.ts:223-231`）与 JSON `option_task` 内容不同是有意的：常量是 v43 旧默认，被 v39 迁移建模块兜底与 v44 迁移 `from` 匹配使用（`global-settings.ts:1262`、`:1508`）。
- 冻结常量 `USER_INSTRUCTION_DEFAULT / LEGACY_USER_INSTRUCTION_TASK / USER_INSTRUCTION_GUIDE` 的 v39/v44 引用成立（`:1276-1283`）。
- option_only/enrich_only 过滤链正确：`buildMessages` 在 isEnrich 时跳过 option_only（`generator.ts:178`）；`enrich-input.ts:41` 不过滤是刻意设计（依赖 buildMessages 兜底），生成侧 `generator.ts:890` 先过滤 enrich_only。

---

## 2. 条目池侧检查明细

### B1 【基本无问题】v46 迁移块（`global-settings.ts:1598-1676`）

- 移除 `LEGACY_GENERAL_TYPES`（4 条）+ `LEGACY_TIME_JUMP_TYPES`（6 条）与 NSFW 旧 2 条（`NSFW·就地取材/情趣道具`），**按 type 匹配删除**——固有风险：用户自建同 type 条目会被一并删除（低概率；v46 已发布运行，仅对 schema<46 老档生效）。
- NSFW 10→8 保留条目的内容升级：仅「内容 === 旧默认」才换新，用户编辑过的不动（`:1621-1636`）。
- `buildAllPoolEntries` 按 type 去重补入新条目（`:1641-1647`）；默认配置重置为「用户主体」8 条（前 2 条 pinned）（`:1649-1658`）。
- `group_order`/`empty_groups` 同步清理并补入 `POOL_GROUP_ORDER` 8 组、「用户主体」排首（`:1660-1675`）。二次执行幂等（旧条目已删 → removedIds 空）。

浏览器实测：条目池 tab 显示「默认配置 8 条已选（2 pinned）、条目库 64 条」与迁移终态一致。

### B2 【无问题】抽取算法（`pool-resolver.ts`）

- pinned 溢出：`send_all` 全发 / `trim` 随机截断取前 count（`:101-111`）。
- `weightedPick`：`key = random()^(1/w)`（Efraimidis–Spirakis 正确形式），weight=0 经 `safeWeight→0.0001` 后 key≈0 几乎不选（`:34-37,49-55`）。
- `drawByCategories`：按 category 分桶轮询、组内加权抽 1、空组跳过、`pickedAny` 防死循环（`:57-93`）。
- oversample：`remaining + ceil(remaining×pct/100)` 池大小封顶（`:42-47`）；`shuffleFinal` 分别打乱 pinned/drawn（`:120-123`）。

### B3 【无问题】effectivePool 解析（`pool-selector.ts:24-42`）

- 悬空 `entry_id`（config 引用已删条目）被静默剔除，不崩溃。
- `enabled !== false` 为配置层停用语义（缺省即启用，schema default true）。
- pinned/weight 走配置覆盖，content/type/rule/category 只读 master_pool（内容层唯一真相源）。
- 浏览器实测已选条目列表正常展示、停用态样式存在（`PoolEditor.vue:105`）。

### B4 【无问题】条目库内容与分组

- 8 组 64 条文案在 `global-settings.ts:125-304`（用户主体/其他角色主体/时间流逝/剧情续写规划/环境与事件/对话交锋/情感关系/NSFW），type 在组内与跨组唯一（v46 已处理 NSFW 类型碰撞，如「变换姿势」→「变换位置」）。
- `EntryPoolDialog.vue`：`groupedEntries` 按名称排序聚合、`empty_groups` 承载「待建分组」（`:254-270,297-323`）、移空分组转 pending（`:344-352`）、合并导入按 id 去重、部分导出置空 configs 并禁止替换导入（`:535-556,664-667`）。

---

## 3. 交叉一致性

- **C1**：`shujuku_enabled` 的 `v37` 初始化块写在 `migratePromptModules`（`global-settings.ts:480-482`）、受 `prompt_rules.schema_version < 17` 守卫，语义错位（应属 applyDefaults）。实际影响无——缺字段由 schema `default(false)` 兜底、v35 heal 会还原。建议把该行移入 applyDefaults 的 v35 段或删除（default 已覆盖）。
- **C2**：字数 clamp 三处共用 `clampCharsValue/sanitizePromptRulesChars`（`settings.ts:21-40`），UI（`GenerationSettings.vue:259-270`）与 watcher 落盘（`global-settings.ts:1799-1803`）一致，前后端纵深防御成立。
- **C3**：去重 refill（`generator.ts:919-980`）：refill 提示词用 `parsed.length - r1.kept.length` 表述剔除数（`:945`，可能为 0）；熔断比例 `dropped / parsed.length` 分母恒为首轮解析数而非本批（`:937`）——均非功能错误，属可读性观察点。`MAX_REFILL_ROUNDS=2` 防死循环。
- **C4**：导出（`PromptEditor.vue:551-592`，v3+config 字段）/导入（`global-settings.ts:2250-2326`）白名单一致，「新建配置」补齐逻辑使配置恒为可用超集。
- **C5 git 交叉验证**：v44/v46 大改（`global-settings.ts` ±1005 行、`choice-prompts-optimized.json` 200 行、`settings.ts` 195 行等）全部落在 **c4352d9** 一个提交内（commit 自称 docs，实际携带大量代码）。`git log -S` 确认 v44/v46 相关字符串首次出现即该提交。除 A3（opt_* 注释超前）与 A6（spec 过时）外，**未发现「注释声称 ≠ diff 实现」类问题**（参照 corrections.md 记录的 v28 `DEFAULT_OPTION_RULES` 教训）。

---

## 4. 验证记录

| 验证项 | 结果 |
|--------|------|
| `pnpm exec vue-tsc --noEmit` | 通过（无输出；单次耗时异常，420s 内完成） |
| `pnpm build` | 通过（34.67s，238 模块；dist 产物更新） |
| `pnpm lint` | 失败（exit 1），主因 `.kilo/worktrees/peach-ranunculus/dist/index.js` 等 worktree dist 产物被 ESLint 扫入（import-x/no-unresolved 等海量报错，与上会话「完整 lint 受 dist 报错影响」一致）。src 侧既有 error 3 类：`option-dedup.ts:22` no-useless-escape、`pinia/no-duplicate-store-ids`（6 个 store 文件）、若干 vue/attributes-order 等 warning——均非本次大改新引入 |
| 浏览器实测 A1 | 编辑不同步快照（确认）；刷新重开**不**丢失（推翻初始静态推断）；「编辑→刷新→切配置」组合才会丢 |
| 浏览器实测 A2 | 单配置场景下工作副本=生效配置，无可见差异；多配置/切聊天场景未实测（本机仅「简洁」1 个配置） |
| 浏览器实测 A5 | 未实测（API 未连接，无法实际生成；需 DebugSettings 观察 lastBuildMessages） |
| console | 无 choice 相关 error/warn（仅酒馆自身 Settings-not-ready、MacrosParser deprecation、CSSStyleSheet SecurityError 警告） |
| 数据卫生 | 浏览器验证使用的测试内容已恢复为配置快照原值并确认一致；未留下脏数据 |

---

## 5. 修复建议清单

| # | 项 | 改动 | 工作量 | 需产品决策 |
|---|-----|------|--------|-----------|
| 1 | A1 | PromptEditor 编辑动作后回写当前归属配置快照（`syncPromptRulesToConfig`） | 小（组件 + store 微调） | 否 |
| 2 | A2 | 三选一：对齐文档 / boot 加载绑定配置 / 生成直读 effectiveConfig | 中 | **是** |
| 3 | A3 | 修正 v44 注释中 opt_* 表述（或删除） | 极小 | 否 |
| 4 | A4 | `generator.ts:881-882` 改读 `rules.option_min/max_chars` 或删除 | 极小 | 否 |
| 5 | A5 | 合并循环中隔离 `option_task`（可选，先浏览器验证再定） | 小 | 否 |
| 6 | A6 | 修订 spec §3 现状快照、§5/§6 标注未实现 | 极小 | 否 |
| 7 | C1 | `shujuku_enabled` v37 初始化移至 applyDefaults 或删除 | 极小 | 否 |
| 8 | lint | 将 `.kilo/worktrees/**/dist` 与 dist 加入 ESLint ignore（恢复完整 lint） | 小 | 否 |

> 注：本报告为只读检查成果；以上修复项未在本任务实施，改码请另起实现任务。

---

## ✅ 修复实施记录（2026-09-09，同批次完成）

| # | 项 | 结果与位置 |
|---|-----|-----------|
| 1 | A1 | 已修复：`global-settings.ts` 模块深度 watch 即时回写当前归属配置快照；浏览器实测「编辑→快照同步」「刷新→编辑保留」均通过 |
| 2 | A2 | 已修复（绑定生效）：`global-settings.ts` 新增 `resolveEffectivePromptConfig`/`syncEffectivePromptConfigToWorkCopy`，初始化与 `CHAT_CHANGED`/`CHARACTER_PAGE_LOADED` 时在未建立编辑归属（`promptEditConfigId` 为空）情况下把生效配置同步到工作副本；浏览器实测初始化同步通过 |
| 3 | A3 | 已修复：v44 迁移注释 removed opt_* 超表述，标注为未实现的 P2 规划 |
| 4 | A4 | 已修复：`generator.ts:881-882` 改读 `gs.settings.prompt_rules.option_min/max_chars` |
| 5 | A5 | 已修复：`buildMessages` 合并循环排除 user↔user 合并（防止任务指令并入历史正文） |
| 6 | A6 | 已修复：`docs/choice-prompt-redesign-spec.md` §3.1 修订现状快照，§5/§6 标注规划未落地 |
| 7 | C1 | 已修复：删除 `migratePromptModules` 内冗余的 `<37` `shujuku_enabled` 初始化块（行为等价） |
| 8 | lint | 已修复：`eslint.config.mjs` globalIgnores 加入 `.kilo/**`（根治 worktree dist 污染与 pinia 重复 store id 误报）；顺带修 `option-dedup.ts` no-useless-escape、`generator.ts` prefer-const —— `pnpm lint` 达 0 error |

验证：`vue-tsc --noEmit` 通过、`pnpm build` 通过、`pnpm lint` 0 error；浏览器回归（A1 同步、A2 初始化、刷新持久化、数据恢复）通过，console 无新增错误。
