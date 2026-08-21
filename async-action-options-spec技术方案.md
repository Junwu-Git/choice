# 异步行动选项（Async Action Options）SillyTavern扩展 — 技术方案

## 0. 定位与技术栈

SillyTavern **原生扩展**（非酒馆助手/JS-Slash-Runner脚本）。选择原生扩展的原因：需要独立持久化设置面板、深度hook `message.extra`（含swipe维度）、读写角色卡 `data.extensions`、可打断的生成请求——这些是原生扩展的强项，脚本运行在iframe沙盒中对主页面上下文的访问受限。

> 备注：`tavern_extension_template` 自己的README建议优先写酒馆助手脚本而非原生插件（脚本体积小、改代码无需刷新网页即可测试、可用jsdelivr自动更新）。本项目仍选原生扩展路线，因为上述持久化/深度hook需求更贴合插件生态，但这是一个已知的权衡取舍，非默认最优解。

### 0.1 基于 StageDog/tavern_extension_template 的技术栈约定

- **语言**：TypeScript
- **UI**：Vue 3 单文件组件（`.vue`），不用手写jQuery/DOM操作
- **状态管理**：Pinia store（模板示例见 `store/settings.ts`）——其他代码通过 `useSettingsStore()` 之类的hook读写配置，改动会自动落盘到酒馆存档，不需要手动调用保存函数
- **数据校验**：Zod（用于settings的schema定义与运行时校验）
- **酒馆接口访问**：
  - 优先用模板提供的 `@sillytavern` 特殊import路径**直接导入酒馆源码文件里导出的函数**（例：`import { uuidv4 } from '@sillytavern/scripts/utils'`），比官方文档里 `getContext()` 暴露的接口全得多
  - 此外可通过全局 `TavernHelper` 访问酒馆助手（若已安装）封装好的接口：楼层消息操作、酒馆变量增删改查、自定义生成配置+流式传输+提示词覆盖/注入、事件监听等——这些封装比自己直接调用底层生成函数更省事，优先复用
- **构建**：`pnpm install` 装依赖，`pnpm build` 打包一次或 `pnpm watch` 持续监听打包，产物固定是单文件 `dist/index.js`（manifest.json的`js`字段已指向这里）。**改代码后必须刷新酒馆网页才能看到效果**（不像酒馆助手脚本那样能实时生效）
- **i18n（可选）**：界面文字用 `` t`文本` `` 包裹，在 `i18n/en.json` 里补英文映射；多语言需要在manifest.json里加对应语言文件
- **版本号**：不用手动改，commit信息里带 `[release]`/`[release minor]`/`[release major]` 时CI自动递增并打包
- **初始化**：仓库clone到 `SillyTavern/public/scripts/extensions/third-party/` 下，需要把 `manifest.json` 和 `package.json` 里的占位符替换成实际扩展名

---

## 1. 核心功能需求

1. 单独调用API生成行动选项，与主对话生成流程解耦（异步，不阻塞/不写入主聊天记录）
2. 前端UI：手机/游戏选择分支按钮风格；主形态是**挂载在最新AI楼层下方的可折叠面板**；悬浮窗、独立按钮作为可选替代形态
3. 生成数量可配置：固定4个 / 固定6个 / 4-8随机（随机时每轮开始先roll一次定死本轮N）

---

## 2. 条目池设计

### 2.1 三级池，覆盖式优先级
`聊天层 > 角色层 > 全局层`

```
effectivePool =
  聊天层有条目 ? 聊天层条目 :
  角色层有条目 ? 角色层条目 :
  全局层条目
```
不做合并；聊天层一旦有内容，角色层/全局层本轮完全不参与抽取。

### 2.2 快速导入
提供"从下层导入到聊天层"的动作：多选角色层/全局层里尚未复制到聊天层的条目，**复制**（非引用/链接）成独立的聊天层条目，复制后与原条目互不影响、可独立编辑。

### 2.3 管理UI
建议**合并成一个界面**，每条目标注"归属层级"（全局/角色/聊天），顶部用tab筛选查看（全部/仅全局/仅角色/仅聊天）。非生效层的条目在视图里做灰显/删除线提示，说明"当前被更高层覆盖，不参与本轮抽取"，防呆。（不做成三个完全独立页面，避免用户忘记覆盖规则、配了角色层却不生效却不自知）

### 2.4 条目字段
- `text`：条目内容
- `pinned`：是否固定（每轮必发）
- `weight`：权重，用于组内加权随机
- `category`：分类/标签，用于抽取时保证类型多样性
- `condition`：触发条件表达式（见第4节，走ST原生变量，不耦合任何第三方插件如柏宝书）

---

## 3. 抽取算法（完整版，含权重/分类/条件）

```
1. 确定生效池 effectivePool（2.1节的覆盖规则）

2. 条件过滤：effectivePool 中每条（含固定条目）跑一遍 condition 判断
   - 不满足条件 → 移出候选
   - 固定条目是否也遵守条件过滤 → 做成开关，默认"遵守"

3. 拆分 pinned / pool（过滤后的固定/非固定）
   N = resolveCount()  // 固定值，或本轮roll出的随机值
   溢出（pinned.length > N）→ 默认策略：不砍固定条目，全部发出（哪怕超过N），
     本轮不再抽非固定条目。做成配置项。
   remaining = max(N - pinned.length, 0)

4. 按 category 对 pool 分组
   下溢（过滤+分组后不够抽 remaining 个）→ 默认"有多少抽多少"，
     不跨层静默补位，只在UI提示"本轮选项少于设定数量"

5. 分组轮询 + 组内加权随机（无放回）：
   groupOrder = shuffle(分类列表)
   循环按 groupOrder 顺序，每次从当前分类里用 Efraimidis-Spirakis 算法
   （key = random()^(1/weight)，按key降序取）无放回抽1条，直到抽满remaining
   或所有分类耗尽。
   → 保证类别层面轮流覆盖 + 类别内部按权重
   → "是否启用分类多样性"做成总开关，关闭则退化为全池加权随机抽remaining个

6. finalSeeds = pinned + drawn，建议送入prompt前整体shuffle一次
   （避免固定条目永远排在前面，导致AI对顺序产生隐性偏好；
   如果希望固定条目在呈现顺序上也保持相对靠前，可做成开关）
```

---

## 4. 触发条件 — 变量桥接（解耦设计）

**不直接读取任何第三方插件（如柏宝书）的内部数据结构。** 条件表达式统一通过 SillyTavern **原生变量系统**（`{{getvar::}}`/`{{setvar::}}`，聊天变量 `chat_metadata.variables` + 全局变量）取值。任何写入这套变量的来源（用户手动`/setvar`、其他脚本、柏宝书等）本插件都不需要感知，天然解耦。

条件表达式格式建议：`变量名 运算符 值`，例如 `地点 == 医院`、`好感度 >= 60`。

后续若要联动柏宝书复用摘要/总结以省token，做成**可选的"数据源桥接"模块**（检测柏宝书是否已加载、走其公开事件/API，而非硬编码依赖其内部结构），不影响主体功能是否可用。此项**非当前优先级**。

---

## 5. Prompt 组装

提示词编辑区设置：第几人称、选项边界/范围、输出格式、每条字数、其他自定义要求。

模板占位符：
- `{{count}}` → 本轮目标数量 N
- `{{pinned}}` → 固定条目文本
- `{{pool_selected}}` → 本轮抽中的非固定条目文本

上下文范围：按**轮数**截取（1层AI+1层user=1轮）；**轮数=0 = 读取全部历史**（无"零上下文"选项）。

---

## 6. API 调用

- 可选择**复用主API**或**设置独立副API**
- 副API配置支持**保存多个**，UI下拉切换
- 需要**取消生成**能力，且取消按钮**不单独放置**——复用同一个"生成/重新生成"按钮，loading态时切换为"取消"
- **实现优先级**：先看 `TavernHelper` 是否已经暴露了"自定义生成配置+流式传输+提示词覆盖/注入"的现成接口（模板文档提到酒馆助手支持这个），优先直接复用这层封装，不必自己重新实现调用逻辑。如果这层封装不够用（比如副API切换、AbortSignal取消这些细节它没覆盖），再用 `@sillytavern` 直接import酒馆源码里的真实生成函数（`script.js`等）——因为能看到真实源码，直接读函数签名确认参数和是否支持 `AbortSignal`，不需要靠猜测

---

## 7. 选中后的行为
选中一个选项后：
- **直接发送**触发生成，或
- **填入输入框**待用户编辑后再发送
两种模式都要支持，用开关切换。

---

## 8. 生成历史与持久化

### 8.1 楼层内多次生成 → 翻页
同一楼层手动多次生成时支持翻页查看最近几次结果；**不跨楼层保留**。

### 8.2 跨楼层持久化 → 挂载在消息对象上
生成的选项数据挂在对应AI消息的 `message.extra` 上（类似swipe机制），使得删除新楼层、回退到之前楼层时，仍能看到该楼层当时生成过的选项。若该消息有多个swipe，选项数据需按 `swipe_id` 再分一层，避免切换swipe时显示错位的历史选项。

```js
message.extra["asyncActionOptions"] = {
  [swipe_id]: {
    generations: [
      { id, timestamp, options: [{ text, sourceEntryId }] }
    ],
    currentIndex: 0   // 翻页指针，默认指向最新一次
  }
}
```

### 8.3 存储位置对照
| 数据 | 存储位置 |
|---|---|
| 全局条目池、全局prompt规则、副API配置列表 | `extension_settings[扩展名]` |
| 角色层条目池 | 角色卡 `character.data.extensions[扩展名]`（随角色卡导出/导入） |
| 聊天层条目池、当前会话轮数/API选择等 | `chat_metadata[扩展名]`（随存档走） |
| 每层生成的选项历史 | `message.extra[扩展名]`，按 `swipe_id` 分层 |

---

## 9. 模块划分建议（按模板的 Vue + Pinia 结构）

```
src/
  core/
    generator.ts          单独调用API生成选项；优先复用TavernHelper生成接口，
                           必要时用 @sillytavern 直接调用酒馆源码生成函数
    pool-resolver.ts       三层池覆盖解析 + 条件过滤 + 分组加权抽取（第3节算法），
                           纯函数，不直接碰酒馆API，方便单测
    variable-bridge.ts     读取ST原生变量（优先走TavernHelper的变量接口），
                           供条件判断使用，不依赖任何第三方插件
    options-store.ts       message.extra 存取（含swipe维度、翻页），
                           读写走 @sillytavern 导出的 chat 数组 / saveChat 相关函数

  store/
    global-settings.ts     Pinia store，对应 extension_settings（全局池、全局prompt、副API列表）
    character-settings.ts  Pinia store，对应角色卡 data.extensions 命名空间（角色层池）
    chat-settings.ts       Pinia store，对应 chat_metadata（聊天层池、会话级设置）
    pool-selector.ts       组合上面三个store，暴露 effectivePool 的覆盖解析结果（2.1节），
                           供UI和pool-resolver共同使用，避免覆盖逻辑散落在多处

  components/
    ActionOptionsPanel.vue     挂载在最新AI楼层下方的可折叠面板（主形态）
    ActionOptionsFloating.vue  悬浮窗形态（可选）
    PoolEditor.vue              合并式条目池管理界面（层级筛选tab + 导入弹窗）
    PromptEditor.vue             提示词规则编辑区

  index.ts                （或沿用模板入口文件）挂载Vue应用、注册事件监听、初始化stores
```

设置面板的读写全部通过对应store的hook（如 `useGlobalSettingsStore()`）访问，组件里不直接调用 `extension_settings`/`chat_metadata`/`character.data.extensions`，统一收口在 `store/` 下三个文件里，方便以后调整存储细节而不用改UI代码。

### 关键事件监听点
- `MESSAGE_RECEIVED`（或生成完成后）→ 自动模式下触发生成
- `MESSAGE_SWIPED` → 切换读取对应swipe维度的选项历史
- 消息删除/楼层跳转 → 重新渲染面板，读取"当前最新AI消息"的extra数据
- 面板生成按钮点击 → 手动触发，同一套 `generator.js` 逻辑

---

## 10. 已知需要在实现时核实的点（版本相关，非设计问题）

这些不用再靠猜测——项目clone自模板后，agent能直接通过 `@sillytavern` import路径访问到本地酒馆的真实源码，建议直接翻源码确认，而不是假设某个函数签名：

- 生成函数（`TavernHelper`封装的生成接口 / 酒馆源码里的 `generateQuietPrompt`、`generateRaw`等）的确切参数签名，是否支持 `AbortSignal`
- `#send_textarea` / `#send_but` 等发送框相关DOM id 是否与目标ST版本一致（用于"选中后填入/直接发送"）
- `character.data.extensions` 命名空间的读写API在目标版本的确切调用方式
- `TavernHelper` 当前版本实际暴露了哪些变量/消息/生成相关接口（模板README列的是能力范围，具体函数名以其类型定义 `@types` 为准）

## 11. 尚未最终决定、留给实现阶段判断或让用户后续拍板的开关项
- 固定条目是否遵守条件过滤（默认：遵守）
- 固定条目数超过N时的溢出策略（默认：不砍固定条目，全发）
- 分类多样性抽取 vs 全池加权随机（做成总开关）
- finalSeeds送入prompt前是否shuffle（默认：shuffle）
- 是否允许"跨层兜底补位"当当前生效层数量不足时（默认：不允许，只提示数量不足）

## 12. 明确排除的范围
- 不与柏宝书（或任何其他第三方插件）的内部数据结构耦合；变量读取统一走ST原生变量层
- 不做成酒馆助手(JS-Slash-Runner)脚本；走原生扩展路线
