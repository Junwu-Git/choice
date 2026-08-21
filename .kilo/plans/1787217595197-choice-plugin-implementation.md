# Choice 异步行动选项插件 — 实施计划

基于 `async-action-options-spec技术方案.md`,技术方案与模板(tavern_extension_template)无根本冲突,可行。本计划采用方案第 11 节全部默认值,并将方案中 4 处需要修正的点落实为硬约束。

## 已确认前提(choice 目录内证据)

- 模板 `@sillytavern/...` 直连酒馆源码机制可用:`vite.config.ts:52-63` resolver + `store/settings.ts:3-4` 已实际使用
- 环境已装 JS-Slash-Runner → `window.TavernHelper` 可用(`@types/function/index.d.ts`),包含本插件所需的全部接口
- `TavernHelper.generate/generateRaw`: `custom_api`(副API)、`overrides`、`injects`、`ordered_prompts`、`max_chat_history`、`should_silence`、`generation_id`(见 `@types/function/generate.d.ts`)
- 取消机制为 `stopGenerationById(generation_id)` / `stopAllGeneration()`,**不是 AbortSignal**(方案需修正)
- 变量接口 `getVariables/replaceVariables/insertOrAssignVariables`,type 含 `chat/global/character/message`(`@types/function/variables.d.ts`)
- 消息接口 `getChatMessages/setChatMessages`,`ChatMessage.extra`、`ChatMessageSwiped.swipe_id/swipes/swipes_data`(`@types/function/chat_message.d.ts`)
- 事件 `MESSAGE_RECEIVED(message_id, type)`、`MESSAGE_SWIPED`、`MESSAGE_DELETED`、`CHAT_CHANGED`、`CHARACTER_MESSAGE_RENDERED`(`@types/iframe/event.d.ts`);`MESSAGE_RECEIVED` 的 type 可为 `'quiet'`
- `#send_textarea`、`#send_but` 存在(已验证 `public/index.html:8093,8109`)

## 硬约束(方案修正点)

1. **取消走 generation_id**:每个生成请求生成 `generation_id = uuidv4()`,取消调 `TavernHelper.stopGenerationById(id)`。若降级 @sillytavern 直调 `generateQuietPrompt`/`generateRaw`,其 option 支持 `signal?: AbortSignal`,可二选一。
2. **TavernHelper 降级分支必须实现**(JS-Slash-Runner 未装时生成功能可用):检测 `window.TavernHelper` 存在与否,不存在则用 `@sillytavern/script` 的 `generateRaw`/`generateQuietPrompt`。副API切换在降级分支下不保证完整(可提示)。
3. **自动模式防自循环**:监听 `MESSAGE_RECEIVED` 时必须过滤 `type !== 'quiet'`(插件自身静默生成也会触发该事件)。
4. **面板挂载独立成模块**(`core/panel-mount.ts`),管理完整 DOM 生命周期,不复用模板的 settings 挂载示例。

## 命名约定

- 统一命名空间 key:`'choice'`(替换 `setting_field = 'tavern_extension_example'`)
- `manifest.json` display_name 保持 `Choice`;i18n 键中文,`i18n/en.json` 补英文映射
- 组件样式用 scoped CSS,不用 tailwind(模板 README 警告会破坏酒馆样式)

## 数据模型(`src/type/settings.ts`,全部用 zod schema + `.prefault({})`)

```ts
PoolEntry = {
  id: string;                 // uuidv4
  text: string;
  pinned: boolean;            // 每轮必发
  weight: number;             // 加权随机,>=0,默认1
  category: string;           // 分类/标签,空=无分类
  condition: string;          // "变量名 运算符 值",空=无条件
}

GenerationSettings = {
  count_mode: 'fixed4' | 'fixed6' | 'random4to8';
  categories_enabled: boolean;        // 分类多样性总开关,默认 true
  shuffle_final: boolean;             // finalSeeds 送 prompt 前 shuffle,默认 true
  pinned_follows_condition: boolean;  // 固定条目是否遵守条件过滤,默认 true
  pinned_overflow: 'send_all' | 'trim'; // 固定数超 N,默认 send_all
  cross_layer_fallback: boolean;      // 跨层兜底补位,默认 false
}

PromptRules = {
  person: string;             // 第几人称等
  output_format: string;      // 输出格式说明
  option_length: number;      // 每条字数
  extra_requirements: string;
  context_rounds: number;     // 按轮数截取,0=全部历史
}

SecondaryApi = { id: string; name: string; apiurl: string; key: string; model: string; source: string }

GlobalSettings = { generation: GenerationSettings; prompt_rules: PromptRules; apis: SecondaryApi[]; pool: PoolEntry[] }
```

角色层/聊天层只存 `{ pool: PoolEntry[] }`;聊天层另存会话级 `{ active_api_id: string | null; auto_generate: boolean; behavior: 'send' | 'fill' }`。

## 存储位置(方案 §8.3)

| 数据 | 位置 | 写入方式 |
|---|---|---|
| 全局池/规则/API 列表 | `extension_settings['choice']` | 模板 Pinia watch + `saveSettingsDebounced()` |
| 角色层池 | `characters[this_chid].data.extensions['choice']` | `@sillytavern/script` 导入 `characters`、`saveCharacterDebounced` |
| 聊天层池/会话设置 | `chat_metadata['choice']` | `@sillytavern/script` 导入 `chat_metadata`、`saveMetadata` |
| 选项生成历史 | `message.extra['choice'][swipe_id].{generations,currentIndex}` | chat 数组直接改 + `saveChat`(或 `TavernHelper.setChatMessages`,实现时验证 merge 语义) |

## 目录结构

```
src/
  core/
    generator.ts         生成管线:prompt 组装 + TavernHelper.generateRaw + 取消 + 结果解析
    pool-resolver.ts     三层池覆盖解析 + 条件过滤 + 分组加权抽取(纯函数,方案§3 算法)
    variable-bridge.ts   读 ST 变量(TavernHelper.getVariables)+ 条件表达式求值
    options-store.ts     message.extra 读写(swipe 维度 + 翻页指针)
    panel-mount.ts       消息面板 DOM 挂载/销毁生命周期
  store/
    global-settings.ts   extension_settings['choice']
    character-settings.ts characters 角色层池(CHAT_CHANGED/换角色时重载)
    chat-settings.ts     chat_metadata['choice']
    pool-selector.ts     effectivePool 覆盖解析(聊天>角色>全局),供 UI 与 pool-resolver 共用
  components/
    ActionOptionsPanel.vue  最新 AI 楼层下方可折叠面板(主形态)
    SettingsPanel.vue       设置抽屉(#extensions_settings2),含 PoolEditor/PromptEditor/API 管理
  type/settings.ts       zod schemas
  util/zod.ts            沿用模板 validateInplace
  index.ts / panel.ts    入口,挂载两个 Vue 应用(共用同一 pinia 实例)
```

## 实施任务(按序)

### P0 骨架与命名
1. 替换 `setting_field` 及所有 `tavern_extension_example` 占位符 → `choice`
2. 建 `type/settings.ts` 全部 zod schemas(含 `.prefault` 默认值)
3. 建 4 个 store:`global-settings`(照抄模板 watch 模式)、`character-settings`(监听 `CHAT_CHANGED`/`CHARACTER_PAGE_LOADED` 重载 `this_chid` 数据,watch 深度保存)、`chat-settings`、`pool-selector`
4. 改造 `index.ts/panel.ts`:pinia 实例化一次,`SettingsPanel` 挂到 `#extensions_settings2`

### P1 设置面板 UI
5. `SettingsPanel.vue`:tabs = 条目池 / 提示词 / API / 行为
6. `PoolEditor`:三级池 CRUD;tab 筛选(全部/全局/角色/聊天);非生效层条目灰显+删除线("当前被更高层覆盖");"从下层复制导入"(多选复制成独立聊天层条目,非引用)
7. `PromptEditor`:人称/输出格式/每条字数/额外要求/上下文轮数
8. API 列表增删改 + 下拉选择(active_api_id,null=主API)
9. 行为开关:数量模式、auto_generate、behavior(send/fill)、categories_enabled、shuffle_final、pinned 相关开关

### P2 算法核心(纯函数)
10. `variable-bridge.ts`:读 `getVariables({type:'chat'})` 与 `{type:'global'}`;条件解析 `name op value`(op: `== != >= <= > <`,值支持数字/字符串/布尔,key 支持点路径 `_.get`);无 TavernHelper 时降级读 `chat_metadata.variables` + 全局变量
11. `pool-resolver.ts` 实现方案 §3 完整算法:覆盖解析→条件过滤(pinned 是否过滤按开关)→pinned/池拆分→resolveCount(fixed/roll)→溢出策略→category 分组→Efraimidis-Spirakis(`key=random()^(1/weight)` 降序)无放回轮抽→shuffle
12. 可选:引入 vitest,为 pool-resolver + 条件解析写单测(此步可跳过,不影响主功能)

### P3 生成管线
13. `options-store.ts`:读写 `message.extra['choice'][swipe_id]`;新增 generation 记录、currentIndex 翻页;删除楼层/回退时清理;保存用 `saveChat`(或 `setChatMessages`,实现时定)
14. `generator.ts`:
    - prompt 组装:`ordered_prompts` 方式(不碰主预设)— 系统指令(人称/格式/字数/额外) + 按轮数截取的聊天历史(`getChatMessages`) + 替换 `{{count}}/{{pinned}}/{{pool_selected}}`
    - 调用 `TavernHelper.generateRaw({ ordered_prompts, custom_api: 选中副API?, generation_id, should_silence: true })`
    - 取消:`stopGenerationById(generation_id)`
    - 结果解析:去 ``` 围栏/去行号/trim 拆条,容错(空行过滤、JSON 兼容)

### P4 消息面板
15. `panel-mount.ts`:监听 `MESSAGE_RECEIVED`(过滤 quiet)/`MESSAGE_SWIPED`/`MESSAGE_DELETED`/`CHAT_CHANGED`/`MORE_MESSAGES_LOADED`,在 `$('#chat .mes.last_mes')` 后挂载/重建 `ActionOptionsPanel` 挂载点,删除/回退/换聊天时销毁
16. `ActionOptionsPanel.vue`:手机游戏按钮风格;折叠;loading 态;同一按钮生成⇄取消切换;多次生成翻页(仅本楼层);生成结果按 swipe_id 对齐
17. 自动模式:`MESSAGE_RECEIVED`(非 quiet)触发;生成防重入(进行中则跳过本轮或排队,默认跳过并提示)
18. 选中行为:`behavior=send` 触发发送(复用主发送逻辑);`fill` 写入 `#send_textarea`(val + 触发 input 事件),由用户编辑后发送

### P5 收尾
19. 补全 `i18n/en.json`
20. `pnpm lint`、`pnpm build` 通过
21. 按下方验证清单手动回归

## 实现时需核实的点(方案 §10)

- `@sillytavern/script` 实际导出:`chat_metadata`、`saveMetadata`、`characters`、`this_chid`、`saveCharacterDebounced`、`chat`、`saveChat` 的确切导出名与签名
- 角色层扩展数据的实际存储位置:本版本 `characters[x].data.extensions` 还是 `characters[x].extensions`
- `TavernHelper.setChatMessages` 对 `extra` 是深合并还是整体替换(决定 options-store 用哪条路)
- `TavernHelper.generate` 流式事件在主页面 eventSource 上的名称(流式展示为可选项,非必需)
- `generateRaw` 的 `ordered_prompts` 与 `custom_api` 组合是否如类型定义所示生效(副API时 ST 版本差异)

## 验证清单

- [ ] 手动生成:手动按钮 / 自动模式(主回复到达后自动出选项)
- [ ] 数量模式:4 / 6 / 4-8 随机(每轮先 roll 定死)
- [ ] 抽取:weight 加权、pinned 必发、category 分类轮抽、condition 过滤(含固定条目过滤开关)、溢出策略
- [ ] 三级池覆盖:聊天>角色>全局;导入复制后独立编辑互不影响;灰显提示
- [ ] 历史:同楼层多次生成翻页;swipe 切换显示对齐;删除/回退楼层后数据仍在、再次前进恢复
- [ ] 会话/角色切换:换聊天、换角色卡后各层数据正确
- [ ] 副API:多配置保存/切换/主API复用;取消按钮中断请求
- [ ] 选中行为:直接发送 / 填入输入框
- [ ] 无 JS-Slash-Runner 环境:降级分支下生成可用(可临时改名扩展验证)

## 明确排除(超出本次范围)

- 悬浮窗形态(`ActionOptionsFloating`)与独立按钮形态
- 柏宝书/任何第三方插件数据桥接(变量统一走 ST 原生层)
- tailwind 引入
- 跨层兜底补位(默认不允许,仅 UI 提示"本轮选项少于设定数量")
