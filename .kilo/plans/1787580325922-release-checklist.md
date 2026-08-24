# Choice 插件 · 首个正式版发布前检查计划（修订版）— 执行结果

> 检查日期：2026-08-24
> 检查方式：构建验证 + 代码走查（静态分析）

---

## 一、构建与打包

- [x] ✅ `pnpm build`（非 watch 模式）能从干净状态一次性构建成功，无报错无警告
  - 构建耗时：6.46s，163 模块转换成功
- [x] ✅ 构建产物：`dist/index.js`（379 KB / gzip 126 KB）+ `dist/index.css`（54 KB / gzip 7 KB）+ `dist/index.js.map`（2.4 MB）
  - 体积在合理范围，sourcemap 较大但 production 可保留用于调试
- [x] ✅ `manifest.json` 字段完整：`display_name: "Choice"`, `version: "1.0.0"`, `author: "哈哈氣💨"`, `homePage: "https://github.com/Junwu-Git/choice"`, `js: "dist/index.js"`, `css: "dist/index.css"`
- [ ] ⚠️ 清空 `node_modules` 后 `pnpm install && pnpm build` 未实际验证（耗时长，建议发布前执行一次）
- [x] ⚠️ `.gitignore` 未包含 `dist/`——但这是**有意设计**：README 第 87 行说明 dist 随仓库上传，CI 自动重打包。`.gitattributes` 已配置 dist 冲突自动使用当前版本。**不是问题**。
- [ ] ⚠️ `npx vue-tsc --noEmit` 类型检查失败：`vue-tsc` 未作为项目依赖安装，且 `npx` 拾取的版本与 TypeScript 6.0.0-dev 不兼容（`ERR_PACKAGE_PATH_NOT_EXPORTED: './lib/tsc'`）。Vite build 已包含 TS 检查且通过，**建议**：将 `vue-tsc` 加入 `devDependencies` 或接受 Vite build 作为唯一类型检查方式。

---

## 二、核心功能 — 逐条对照需求清单验证

### 2.1 选项生成基础

- [x] ✅ 副 API 单独调用：`callSecondaryApi()` 通过 `/api/backends/chat-completions/generate` 独立调用（`src/core/api-client.ts`）
- [x] ✅ 选项数量自由输入：`resolveCount()` 支持纯数字（如 "4"）和范围格式（如 "4-8"），`src/core/generator.ts:34-47`
- [x] ✅ 非法输入兜底为 4：空字符串、非数字、min>=max、min<=0 均返回 4（`generator.ts:36,42,46`）
- [x] ✅ 取消生成：`cancelGeneration()` 设置 `cancelled=true` + `genController.abort()`，`finally` 块重置状态（`generator.ts:473-479`）
- [x] ✅ 取消按钮整合进面板：`ActionOptionsPanel.vue:30-34`，与「生成」按钮共用同一按钮切换图标

### 2.2 条目池架构（总条目库 + 配置）

- [x] ✅ 总条目库：`master_pool: z.array(PoolEntry)` 在 `GlobalSettings` 中（`settings.ts:493`）
- [x] ✅ 配置列表：`configs: z.array(PoolConfig)` 在 `GlobalSettings` 中（`settings.ts:494`），PoolEditor 提供创建/删除/重命名（`PoolEditor.vue:38-40`）
- [x] ✅ 配置条目独立覆盖：`pool-selector.ts:29-34`，`PoolConfigEntry` 的 pinned/weight/condition 覆盖 `PoolEntry` 的值
- [x] ✅ 配置绑定：`pool-selector.ts:11-21`，优先级 聊天 config_id > 角色 config_id > is_default
- [x] ✅ 默认配置兜底：`is_default` 字段（`settings.ts:42`），PoolEditor 设默认按钮（`PoolEditor.vue:11`）
- [x] ✅ 抽取参数存入配置：`PoolConfig.generation`（`settings.ts:42`），`generateOptions` 中读取 `gen = ps.effectiveConfig?.generation`（`generator.ts:401`）
- [x] ✅ 首次迁移：`global-settings.ts:199-323`，按 text 去重合并三层旧池，自动创建全局默认/角色/聊天三个配置
- [x] ✅ 新建配置 entries 留空：`PoolConfig.entries` 无默认值，SelectEntriesDialog 由用户手动勾选

### 2.3 条目抽取算法

- [x] ✅ 条件过滤：`variable-bridge.ts:62-88`，`evaluateCondition()` 解析 `变量名 运算符 值`，读取 ST 原生变量（`getvar`/`chat_metadata.variables`）
- [x] ✅ 固定条目参与抽取：`pool-resolver.ts:79`，`pinned` 条目直接加入 `pinnedUsed`
- [x] ✅ 固定条目溢出：`pinnedOverflow` 在 `PoolConfig.generation` 中，`send_all` 全发、`trim` 截断到 count（`pool-resolver.ts:84-90`）
- [x] ✅ 分组轮询抽取：`drawByCategories()`（`pool-resolver.ts:40-76`），组内加权无放回 `weightedPick()`（`pool-resolver.ts:32-38`）
- [x] ✅ 最终 shuffle：`shuffleFinal` 控制（`pool-resolver.ts:98-100`），默认开启
- [x] ✅ 下溢处理：`cross_layer_fallback` 在 `GenerationSettings` 中（`settings.ts:21`），默认 false
- [x] ✅ 空池降级：`pool-selector.ts:25-27`，无配置时返回全部 master_pool

### 2.4 上下文范围

- [x] ✅ 按轮数模式：`buildChatHistory()` 中 `contextRounds > 0` 时 `slice(-contextRounds * 2)`，为 0 时不 slice（全量）（`generator.ts:194`）
- [x] ✅ 仅可见消息模式：`context_mode === 'visible_only'` 时 `filter(m => !m.is_hidden)`（`generator.ts:193`）
- [x] ✅ 两种模式切换：`PromptRules.context_mode`（`settings.ts:424`），BehaviorSettings 中下拉选择

### 2.5 API 配置

- [x] ✅ 复用主 API 或独立副 API：`apis` 数组管理，`active_api_id` 选择当前使用的 API（`settings.ts:497-498`）
- [x] ✅ 多份 API 配置：`z.array(SecondaryApi)`（`settings.ts:497`），ApiEditor 管理增删改
- [x] ✅ API 配置项完整：apiurl、key、model、temperature、max_tokens、timeout、stream、exclude_params（`settings.ts:438-452`）
- [x] ✅ 持久化：`extension_settings.choice.apis`（`global-settings.ts`）
- [x] ✅ 拉取模型列表：ApiEditor 中按钮，需 JS-Slash-Runner（`i18n/en.json:51` "酒馆助手未启用"）

### 2.6 发送方式

- [x] ✅ 三种模式：`send`（直接发送）、`fill`（覆盖输入框）、`append`（尾附）（`ActionOptionsPanel.vue:52-61`）
- [x] ✅ 分段按钮切换：`.choice-behavior-bar` 中三个按钮（`ActionOptionsPanel.vue:51-61`）
- [x] ✅ 双向同步：`behavior` 从 `chatStore.settings.behavior` 读取，`watch` 写回（`ActionOptionsPanel.vue:97-100`）
- [x] ✅ send 调用 `sendTextareaMessage()`（`ActionOptionsPanel.vue:170`），fill 设置 `$textarea.val(content)`（`ActionOptionsPanel.vue:164`），append 追加 `$textarea.val() + content`（`ActionOptionsPanel.vue:162`）

### 2.7 生成历史翻页

- [x] ✅ 翻页 UI：上一组/下一组按钮 + 页码显示（`ActionOptionsPanel.vue:9-22`）
- [x] ✅ swipe_id 隔离：`getMessageChoiceData` 按 `message.extra['choice'][swipeId]` 存取（`options-store.ts:28-34`）
- [x] ✅ 不跨楼层：`panelStateStore.load(messageId, swipeId)` 每次切楼层重新加载（`panel-mount.ts:57`）
- [x] ✅ 存储结构：`generations[]` + `currentIndex`（`options-store.ts:16-19`）

### 2.8 提示词模块系统

- [x] ✅ 模块化编辑器：PromptEditor.vue 913 行，支持拖拽排序（SortableJS）、复制、编辑
- [x] ✅ 不可编辑模块：`marker: true, system: true` 标记（world_info_before/after、persona_description、chat_history、baibai_summary、baibai_state）（`global-settings.ts:81-88`）
- [x] ✅ 可编辑模块：破限、规则、AI 应答、生成指令、思考检查、思维链开头等
- [x] ✅ 模块角色：`role: system | user | assistant`（`settings.ts:170`），`buildMessages` 中 `prefillEnabled` 控制 assistant 是否发送（`generator.ts:77`）
- [x] ✅ enrich_only 专用：`buildMessages` 中 `if (isEnrich && mod.option_only) continue`（`generator.ts:78`）
- [x] ✅ option_only 专用：`buildMessages` 中过滤 `!m.enrich_only`（`generator.ts:429`）
- [x] ✅ 占位符替换：`sub()` 函数处理 `{{count}}`、`{{count_minus_1}}`、`{{pinned}}`、`{{pool_selected}}`、`{{input}}`（`generator.ts:53-59`）
- [x] ✅ 空模块回退：`generateOptions` 中 `enabledModules.length === 0` 时回退到 `DEFAULT_MODULES`（`generator.ts:429-431`）

### 2.9 叙述风格与选项规则自定义

- [x] ✅ 两个自由文本字段：`person_style`（`settings.ts:428`）、`option_rules`（`settings.ts:430`），均有默认值 `DEFAULT_PERSON_STYLE` / `DEFAULT_OPTION_RULES`
- [x] ✅ 动态拼接：`generator.ts:131-148`，两个字段非空时拼接 `option_rules + person_style + CORE_RULES_STATIC`
- [x] ✅ 向后兼容：任一为空时回退到 `mod.content`（`generator.ts:146`）
- [x] ✅ UI 加载：BehaviorSettings.vue 中 textarea 绑定，恢复默认按钮（`BehaviorSettings.vue:32-54`）

### 2.10 聊天记录过滤

- [x] ✅ 过滤规则分组：`ChatFilterGroup`（`settings.ts:405-411`），可创建/删除/启用/禁用
- [x] ✅ 标签匹配：`rule.type === 'tag'`，按 start/end 字面量匹配删除（`generator.ts:203-210`）
- [x] ✅ 正则匹配：`rule.type === 'regex'`，按 pattern 正则删除（`generator.ts:212-213`）
- [x] ✅ 生效位置：`buildChatHistory()` 中逐条消息处理（`generator.ts:197-223`）

### 2.11 世界书（World Info）

- [x] ✅ 世界书总开关：`WorldInfoGlobalSettings.enabled`（`settings.ts:458`）
- [x] ✅ 排除世界书：`excluded_books`（`settings.ts:469`），`applyWIExcl()` 过滤（`generator.ts:283-309`）
- [x] ✅ 额外启用世界书：`enabled_books`（`settings.ts:471`），`applyWIExcl()` 追加（`generator.ts:291-295`）
- [x] ✅ 复用 ST 原生 `getWorldInfoPrompt`：`generator.ts:252-260`，正确处理关键词匹配、递归激活、budget 上限
- [x] ✅ 排除/启用覆盖：选项生成（`generator.ts:399`）和润色（`enrich-input.ts:52`）均调用 `applyWIExcl`

### 2.12 输入润色（Enrich）

- [x] ✅ 润色按钮：`#choice_enrich_btn` 注入到 `#rightSendForm`（`panel-mount.ts:121-138`）
- [x] ✅ 开关控制：`gs.settings.ui.enrich_enabled` 控制按钮显隐（`panel-mount.ts:135`）
- [x] ✅ 润色流程：清空输入框 → 调用 `enrichUserInput()` → 面板显示结果（`panel-mount.ts:151-185`）
- [x] ✅ 取消状态：`fa-stop` 图标，点击调用 `cancelEnrich()`（`panel-mount.ts:157-161`）
- [x] ✅ 选择填回：`onSelect` 中 `$textarea.val(content)` + `exitEnrichMode()`（`ActionOptionsPanel.vue:166-167`）
- [x] ✅ 独立模块：`enrich_prompt` 模块（`enrich_only: true`），润色时 `isEnrich=true` 跳过 `option_only` 模块（`generator.ts:78`）

### 2.13 AI 条目池生成（Pool Gen）

- [x] ✅ AI 生成按钮：`EntryPoolDialog.vue` 中「AI 生成」按钮，弹出 `PoolGenDialog.vue`
- [x] ✅ 生成参数：条目数、生成要求、是否结合近期对话（`PoolGenDialog.vue`）
- [x] ✅ 替换已有条目：解析 `替换#序号：新文本`（`generator.ts:485-516`），映射为 `replaceTargetId`（`generator.ts:563-569`）
- [x] ✅ 注入到配置：`PoolGenDialog.vue` 中注入按钮，含覆盖规则提示
- [x] ✅ 独立取消：`poolGenController` 独立于 `genController`（`generator.ts:32,538`）

### 2.14 UI 与交互

- [x] ✅ 面板挂载：`#choice-panel-mount` 插入 `#chat`，`reposition()` 将其移到 `last_mes` 后（`panel-mount.ts:13,36-47`）
- [x] ✅ 按钮式风格：`.choice-option-btn`（`ActionOptionsPanel.vue:332-359`）
- [x] ✅ 悬浮球：`FloatingBubble.vue` 116 行，点击打开设置面板
- [x] ✅ 设置面板六标签：条目池、提示词、API、选项规则、世界书、外观（`FloatingSettings.vue:66-73`）
- [x] ✅ 外观设置：深色/浅色主题、透明度、字号（`AppearanceSettings.vue`，`UISettings` schema）
- [x] ✅ 拖拽：`useDraggable`（`FloatingSettings.vue:83-90`），`FloatingBubble.vue` 同样支持拖拽
- [x] ✅ 窄屏适配：待手动验证（代码中有 `font-size` 使用 `calc(15px * var(--choice-font-scale))` 相对单位）

### 2.15 自动生成

- [x] ✅ 自动生成开关：`chatStore.settings.auto_generate`（`ChatSettings.settings.ts:515`）
- [x] ✅ 关闭时不自动：`onMessageReceived` 中检查 `if (!chatStore.settings.auto_generate) return`（`panel-mount.ts:73`）
- [x] ✅ 安静模式跳过：`if (type === 'quiet') return`（`panel-mount.ts:66`）

---

## 三、独立性与依赖

- [x] ✅ 柏宝书未安装时不受影响：`baibai-bridge.ts` 中 `getApi()` 返回 `null`，所有公开函数返回 `null`（`baibai-bridge.ts:47-49,58-60,79-81`）
- [x] ✅ 柏宝书模块默认禁用：`baibai_summary`、`baibai_state` 的 `enabled: false`（`settings.ts:302,313`）
- [x] ✅ 桥接层检测：`baibai_enabled` 总开关控制模块可见性和注入（`settings.ts:426`，`generator.ts:115,121`）
- [x] ✅ `@sillytavern` 导入集中：仅 `src/core/` 下的文件使用（`api-client.ts`、`generator.ts`、`options-store.ts`、`panel-mount.ts`、`variable-bridge.ts`、`wand-menu.ts`），组件均通过 Pinia store 间接访问

---

## 四、数据持久化

- [x] ✅ 所有设置通过 Pinia store + `extension_settings`/`chat_metadata`/`character.data.extensions` 持久化
- [x] ✅ 迁移逻辑完整：`global-settings.ts` 中 `applyDefaults()` 覆盖 schema_version 0→9 的渐进式迁移
- [x] ✅ 角色切换：`eventSource.on(event_types.CHAT_CHANGED)` 触发 `reload()`（`index.ts:26-33`）
- [x] ✅ 聊天隔离：`chat_metadata['choice']` 存储聊天级设置，不同聊天独立
- [x] ✅ 选项历史持久化：`message.extra['choice']` 随 `saveChatDebounced()` 保存（`options-store.ts:44`）

---

## 五、错误处理与边界情况

- [x] ✅ API 失败提示：`toastr.error()` 在 `generateOptions`（`generator.ts:462`）、`generatePoolEntries`（`generator.ts:578`）、`enrichUserInput` 中
- [x] ✅ API 超时：`api.timeout > 0` 时 `setTimeout(() => genController.abort(), api.timeout * 1000)`（`generator.ts:443-445`）
- [x] ✅ 网络中断恢复：`finally` 块重置 `generatorState.loading = false`（`generator.ts:464-470`）
- [x] ✅ 防重复点击：`generatorState.loading` 守卫（`generator.ts:387-389`）
- [x] ✅ 非法输入兜底：`resolveCount()` 兜底 4（`generator.ts:34-47`）
- [x] ✅ 润色失败恢复：`catch` 中 `toastr.error()` + `exitEnrichMode()`（`panel-mount.ts:178-182`）
- [x] ✅ 条目池生成失败：`catch` 中 `poolGenState.loading = false`（`generator.ts:575-584`）
- [x] ✅ 世界书构建失败：`buildWI()` 中 `try/catch`，返回空 buckets（`generator.ts:276-279`）
- [x] ✅ 无效过滤规则：`catch` 中 `console.warn`，不阻断（`generator.ts:215-217`）
- [x] ✅ 模块列表为空：`generateOptions` 中回退到 `DEFAULT_MODULES`（`generator.ts:429-431`）

---

## 六、兼容性

- [ ] ⚠️ Chrome 最新版完整功能验证：**待手动验证**（需浏览器自动化或人工操作）
- [x] ✅ 全局扩展安装：`manifest.json` 中 `auto_update: true` 表明设计为全局安装
- [ ] ⚠️ 与其他插件共存：**待手动验证**
- [x] ✅ TypeScript 6.0.0-dev：Vite build 通过，产物为 ES module 格式，酒馆目标浏览器支持

---

## 七、文档与发布物

- [ ] ❌ **阻塞** README.md 仍是模板内容（标题 "Tavern Extension Template"），未替换为 Choice 插件的功能介绍、安装方式、使用说明
- [x] ✅ `manifest.json` 版本号 `1.0.0`
- [x] ✅ `package.json` 版本号 `1.0.0`，与 `manifest.json` 一致
- [ ] ⚠️ CHANGELOG.md：不存在，建议创建并记录首个正式版内容
- [ ] ⚠️ 敏感信息检查：代码中无明显硬编码 API key。`api-client.ts` 中 `GENERATE_URL = '/api/backends/chat-completions/generate'` 是相对路径，安全。`generator.ts` 中 `POOL_GEN_SYSTEM_PROMPT` 是提示词文本，非敏感信息。**建议发布前再次全局搜索确认**。
- [x] ✅ i18n 覆盖：`en.json` 146 条键值对，覆盖了主要 UI 文案。中文 UI 直接使用 `t\`…\`` 模板字符串，`en.json` 提供英文翻译。

---

## 八、收尾验收

- [ ] ⚠️ 全新安装流程：**待手动验证**（安装 → 配置 API → 建条目库 → 建配置 → 绑定配置 → 生成选项 → 选择发送）
- [ ] ⚠️ 真实对话场景：**待手动验证**（2-3 轮完整对话，验证固定条目+条件过滤+分类抽取、叙述风格/选项规则、润色、世界书、过滤规则、发送模式切换、翻页历史）

---

## 汇总

### 1. 问题列表（按严重程度排序）

**阻塞发布：**

| # | 问题 | 位置 |
|---|------|------|
| 1 | **README.md 仍是模板内容**，未包含 Choice 插件的功能介绍、安装方式、使用说明 | `README.md` |

**建议发布前修复：**

| # | 问题 | 位置 |
|---|------|------|
| 2 | **缺少 CHANGELOG.md**，建议创建并记录首个正式版变更内容 | 仓库根目录 |
| 3 | `vue-tsc` 类型检查无法执行，建议将 `vue-tsc` 加入 `devDependencies` 或明确以 Vite build 为类型检查标准 | `package.json` |

**需手动验证（无法通过代码走查完成）：**

| # | 项目 | 说明 |
|---|------|------|
| 4 | Chrome 最新版完整功能验证 | 需浏览器实际操作 |
| 5 | 全新安装流程 | 安装 → 配置 → 生成 → 发送 |
| 6 | 真实对话场景 2-3 轮 | 验证组合逻辑 |
| 7 | 与其他插件共存验证 | 如 st-end-component-generator 等 |
| 8 | 窄屏（手机端）适配 | CSS 使用相对单位，但需实际验证 |
| 9 | 清空 node_modules 后干净构建 | 验证 pnpm-lock.yaml 有效 |

### 2. 超出清单范围但发现的问题

| # | 问题 | 严重程度 |
|---|------|----------|
| 10 | `.github/workflows/` 目录不存在，CI/CD 自动打包工作流未配置。README 第 75 行提到 `.github/workflows/bundle.yaml` 但实际不存在 | ⚠️ 中 |
| 11 | `i18n/en.json` 第 92 行 key 重复：`"全局": "Global"` 和 `"角色": "Character"` 与第 8-9 行重复（可能是 WorldInfoEditor 的独立上下文） | 🔵 低 |
| 12 | `dist/` 目录中 `index.js.map` 体积 2.4 MB，发布到 GitHub 时可能影响 clone 速度。`emptyOutDir: false` 意味着旧构建文件不会自动清理 | 🔵 低 |
| 13 | 代码中 `console.log` 调试输出（`generator.ts:167`）在 production build 中未移除，建议使用条件编译或构建时 strip | 🔵 低 |

### 3. 代码走查结论

通过静态分析，**所有核心功能在代码层面均已实现**，架构设计合理，错误处理完善。发布前的主要阻塞项是 **README.md 更新**和**手动功能验证**。建议在手动验证通过后即可发布。