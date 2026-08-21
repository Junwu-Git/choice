# choice（异步行动选项）— 项目说明（给 Agent）

SillyTavern 第三方扩展，基于 `tavern_extension_template` 二次开发。核心功能：单独调用API异步生成"行动选项"，供玩家点选后填入/发送。TypeScript + Vue 3 + Pinia + Zod + Vite 构建，产物打包为单文件 `dist/index.js`，随扩展clone进酒馆真实安装目录后加载。

## 与我协作时的约定

- 回复用中文。
- 代码注释：简体中文、简洁、解释"为什么"而非"做什么"——尤其是覆盖规则、抽取算法这类容易被后来者简化/写错的逻辑，注释要点出"为什么不能这样简化"。
- 任何来自 `@sillytavern/...` 的导入，函数签名/导出名不允许凭记忆假设，必须先去clone进来的真实酒馆源码里核实（或查`TavernHelper`类型定义），核实方式和结论写进注释，方便复查。
- 改代码后必须 `pnpm build`，**没有热更新**——验证效果要求刷新酒馆网页，不要假设改完代码就能立刻在浏览器里看到变化。
- 每次功能验证请说明"如何在浏览器里手动确认"这一步具体怎么操作，不要只凭代码审查判断"应该没问题"。

## 关键架构约束

- **技术栈边界**：严格用 TS + Vue 3 SFC + Pinia + Zod，不允许手写jQuery/直接DOM操作（`document.createElement`、`.innerHTML`拼接这类）。参考模板自带的Vue+Pinia+Zod示例风格。
- **设置一律走 Pinia store**：组件内不允许直接读写 `extension_settings`/`chat_metadata`/`character.data.extensions`，必须经过对应的 `useXxxStore()`。
- **`@sillytavern` 导入的隔离原则**：这类导入（直接摸真实酒馆源码，不是npm包）只允许出现在 `src/core/` 下的文件里，不允许散落进Vue组件——酒馆升级导致导出改名时，改动范围收窄在这几个文件。
- **禁止把TavernHelper/酒馆变量系统当作对第三方插件（柏宝书等）的硬依赖**：条件表达式统一走ST原生变量（`getvar`/`setvar`/`chat_metadata.variables`），不直接读取任何第三方插件内部数据结构。后续如需联动柏宝书摘要/总结，做成可选的、检测式的桥接模块，不影响主体功能可用性。
- **提示词组装必须走角色结构，不允许拼成一整段字符串塞进单条user消息**：
  - `system`（或`systemPrompt`）＝ 提示词编辑区设置的规则（第几人称、格式、字数等）
  - `user`（或`prompt`）＝ 抽中的固定/随机条目素材 + 按轮数截取的上下文
  - 可选 `assistant`（`prefill`）＝ 预填输出格式起手式（比如强制"- "开头）
  - 优先用 `TavernHelper` 的 `generate`/`generateRaw`（`RolePrompt[]` / `overrides` / `injects`），或酒馆原生 `generateRaw({systemPrompt, prompt, prefill})`；不允许自己拼一整段字符串再整体当prompt参数传。
- **三层条目池是覆盖式，不是合并**：`聊天 > 角色 > 全局`，聊天层非空则本轮抽取完全忽略角色层/全局层。写抽取逻辑时最容易被简化成merge，需要专门测试这条边界。
- **楼层持久化挂在消息对象上**：生成结果存进对应AI消息的 `message.extra['asyncActionOptions']`，按 `swipe_id` 再分一层（类似swipe机制），保证切楼层/切swipe时选项历史不串。同楼层多次生成走 `generations[]` + `currentIndex` 翻页，不跨楼层保留。

## 目录（按§9模块划分，实现时对齐真实文件结构）

- `src/core/` — `generator.ts`（单独调用API生成，结构化role prompt，支持取消）、`pool-resolver.ts`（三层覆盖解析+条件过滤+分组加权抽取，纯函数）、`variable-bridge.ts`（读ST原生变量，不依赖第三方插件）、`options-store.ts`（`message.extra`存取，含swipe维度、翻页）。
- `src/store/` — `global-settings.ts`（对应`extension_settings`）、`character-settings.ts`（对应角色卡`data.extensions`）、`chat-settings.ts`（对应`chat_metadata`）、`pool-selector.ts`（组合三个store，暴露覆盖解析后的`effectivePool`）。
- `src/components/` — `ActionOptionsPanel.vue`（挂载在最新AI楼层下方的可折叠面板，主形态）、`ActionOptionsFloating.vue`（悬浮窗，可选形态）、`PoolEditor.vue`（合并式条目池管理，层级筛选tab+导入弹窗）、`PromptEditor.vue`（提示词规则编辑区）。
- `docs/` — 技术方案文档（`async-action-options-spec.md`）与早期MVP原型，作为背景参考，不是当前实现标准（当前实现以本文件+spec.md里模板适配部分为准，MVP原型是vanilla JS写的，架构已不适用，仅供理解需求）。

## 三层条目池 & 抽取算法要点

- 条目字段：`text`、`pinned`、`weight`、`category`、`condition`（表达式格式如`变量名 运算符 值`，例：`地点 == 医院`）。
- 抽取顺序：确定生效池（覆盖式）→ 条件过滤（含固定条目，默认遵守过滤，可配开关）→ 拆分固定/非固定，处理溢出（默认固定条目不砍，全发）→ 按category分组，处理下溢（默认有多少抽多少，不跨层兜底）→ 分组轮询+组内加权无放回抽取（Efraimidis-Spirakis算法：`key = random()^(1/weight)`，降序取）→ 送入prompt前整体shuffle一次（默认开启，避免固定条目位置固定造成AI顺序偏好）。
- 详细算法与各开关的默认值见 `docs/async-action-options-spec.md` 第3节。

## 构建与验证

```bash
pnpm install
pnpm build          # 一次性打包，验证TS类型和构建是否通过
npx vue-tsc --noEmit # 单独跑类型检查
```

**`pnpm watch` 由我在独立终端里全程跑着**，不需要agent自己调用——`watch`是常驻进程不会退出，agent的工具调用是"跑命令等结束"模式，扔给它一个不结束的命令会卡住。agent只需要用一次性的`pnpm build`（或`vue-tsc --noEmit`）自查有没有类型/编译错误。

因为`watch`已经在跑，代码改完会自动重新打包，**但浏览器仍然需要手动刷新**才能看到效果（无热更新）。如需实际点击/交互验证（比如面板展开、选项按钮点击后的填入/发送行为），优先用浏览器自动化工具（Playwright类MCP）打开本地酒馆实例操作并自行刷新页面，而不是只做静态代码审查、也不要指望我去手动刷新确认。

## 已知需要在实现时核实、不要凭记忆假设的点

- 生成函数（`TavernHelper`封装接口 / 酒馆源码里的`generateQuietPrompt`、`generateRaw`）的确切参数签名，是否支持`AbortSignal`。
- `#send_textarea` / `#send_but` 等发送框DOM id 是否与实际安装的酒馆版本一致。
- `character.data.extensions` 命名空间的读写API在目标版本的确切调用方式。
- `TavernHelper`当前版本实际暴露了哪些变量/消息/生成相关接口，以其类型定义（`@types`）为准，不要以文档描述的能力范围直接猜函数名。
