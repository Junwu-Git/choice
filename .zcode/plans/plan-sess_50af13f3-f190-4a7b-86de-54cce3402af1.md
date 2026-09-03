# 实施计划:配置内条目停用开关 + 正则过滤「标签提取」

## 功能一:条目池配置内条目停用开关

数据流已核实:config 条目(`PoolConfigEntry`)仅持有 `entry_id/pinned/weight` 三个字段,`effectivePool` 在 `src/store/pool-selector.ts` 的 filter 阶段组装——**停用语义放在这一层剔除即可,抽取算法 `pool-resolver.ts` 零改动**。

1. **`src/type/settings.ts`** — `PoolConfigEntry` 新增 `enabled: z.boolean().default(true)`。老存档缺字段由 Zod default 自动补 `true`(语义天然向后兼容,无需 bump SCHEMA_VERSION,与现有 `UISettings.panel_lock` 同一先例)。
2. **`src/store/pool-selector.ts`** — `effectivePool` 的 filter 增加 `entryMap.get(e.id)!.enabled !== false` 判断,停用条目在解析层直接消失(条目计数等下游 UI 自动反映)。
3. **新建 `src/components/shared/ChoiceSwitch.vue`** — 共享滑动开关组件:底层 `<input type="checkbox">` + `appearance:none` 定制为 pill 底+滑动圆点(颜色走 `--choice-primary` 等 token),视觉上与「固定」checkbox 明显区分。
4. **`src/components/PoolEditor.vue`** — 条目行 `.choice-inline-entry-fields` 首位插入选择开关(绑定 `cfgEntry.enabled`,`title` 提示"停用后条目保留在配置中但不参与生成");停用条目整行加半透明 class(参考 FilterGroupPanel 的 dimmed 样式);`handleSelectEntries` push 新条目时显式 `enabled: true`;确认窄屏压缩样式下开关不挤爆行。

## 功能二:正则过滤「标签提取」

### 设计核心(不与现有规则冲突的关键)
- **执行顺序固定**:每条消息先跑「提取遍」——收集所有提取规则的 `<标签名>…</标签名>` 区间(并集),保留区间(含标签壳)、舍弃其余;然后**现有 tag/regex 规则照旧在提取结果上继续执行**,天然满足"用标签过滤再滤掉提取内容里不想要的部分"。顺序不依赖规则排列,新手无脑用;没有提取规则的用户行为零变化。
- 标签匹配用 `escapeRegExp` 字面量(与现有 tag 规则同法),区间排序后合并重叠/去重;消息提取后为空则丢弃(与现有"过滤后为空丢弃"一致)。

### 改动点
1. **`src/type/settings.ts`**:
   - `ChatFilterRule`(discriminatedUnion)新增第三分支 `{ type: 'extract', tag_name: z.string().default('') }`——`tag_name` 存纯标签名(如"思考"),不带尖括号。
   - `RegexLibraryEntry.type` 枚举扩为 `['tag','regex','extract']`,同样加 `tag_name` 字段。纯新增,旧数据零影响,无需迁移。
2. **`src/core/generator.ts` `buildChatHistory`** — 在现有逐规则循环前插入提取遍:若有 extract 规则,matchAll 收集区间→排序合并→拼接为新 content;循环内 extract 类型跳过(留给提取遍处理)。
3. **`src/store/global-settings.ts`**:
   - `sortedEnabledFilterRules` 展开库条目时带上 `tag_name` 字段。
   - 新增 action:`ensureExtractGroup()`——固定 id 的专用全局分组「标签提取」(不存在则创建、存在则复用,始终生效),供快速区读写;`addExtractRule(tagName)` / `removeExtractRule(...)`。
4. **`src/components/FilterEditor.vue`** — 顶部状态栏之下、全局区之前插入「标签提取」快速区:一句说明文案 + 标签名输入框 + 添加按钮 + 已添加标签 chips(可删)。规则即专用分组里的 inline extract 规则,用户在下面全局区也能看到/管理它。
5. **`src/components/FilterGroupPanel.vue`** — 内联规则类型下拉新增 `<option value="extract">标签提取</option>`,选中后显示单输入框「标签名」;类型切换改用 handler 重建规则对象(discriminatedUnion 字段不残留,顺带规避 vue-tsc 对 union 字段访问的报错);`getLibEntryDisplay` 加 extract 分支(显示 `<思考>…</思考>`)。
6. **`src/components/RegexLibraryDialog.vue`** — 库条目类型选择同步加 extract 选项与对应编辑/展示逻辑。
7. **`src/core/guide-content.ts`** — filter tab 的 PAGE_HINTS 文案补充标签提取说明(标注为新手推荐入口);`filter-zones` 向导步骤文案补一句,引导内容仍单一来源维护。

## 验证
1. `pnpm build` + `npx vue-tsc --noEmit` 退出码 0。
2. 改动涉及核心生成链路(过滤应用)与条目池解析,属核心交互——构建通过后按约定先暂停询问本次是否做浏览器验证,需要则走 chrome-devtools-mcp 完整自检(条目开关停用后生成不包含该条目;标签提取后 prompt 只含标签内容;提取+标签过滤组合二次过滤生效;console 无新增报错)。