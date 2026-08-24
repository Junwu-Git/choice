# 聊天记录过滤：标签 + 正则 双模式

## 目标
将现有"仅正则"的聊天记录过滤，扩展为两种匹配方式，二者可混用：
1. **标签匹配**：填入「标签头」和「标签尾」，按**字面量**匹配二者之间的内容（含跨行）并剔除。
2. **正则匹配**：填入正则表达式，剔除匹配内容（保持现有行为）。

两种方式统一在一个规则列表里，每条规则带类型切换。

## 已确认决策
- 标签头/尾按**字面量**匹配：自动转义正则特殊字符，用户填 `<思考>` / `</思考>`、`[小剧场]` / `[/小剧场]` 即可，无需手动转义 `[ ] *` 等。
- UI 用**统一列表 + 每行类型切换**（标签模式显示头/尾两个输入框，正则模式显示一个输入框）。
- 标签匹配语义：`转义(头) + [\s\S]*? + 转义(尾)`，全局标志 `g`，非贪婪、跨行。

## 数据模型（src/type/settings.ts）
新增 `ChatFilterRule` 判别联合，并在 `PromptRules` 中用 `chat_filter_rules` 替换旧字段 `chat_filter_regexes`：

```typescript
export const ChatFilterRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tag'), start: z.string().default(''), end: z.string().default('') }),
  z.object({ type: z.literal('regex'), pattern: z.string().default('') }),
]);
export type ChatFilterRule = z.infer<typeof ChatFilterRule>;
```

`PromptRules` 中：
```typescript
chat_filter_rules: z.array(ChatFilterRule).default([]),  // 替换 chat_filter_regexes
```

## 迁移（src/store/global-settings.ts）
- `prompt_rules.schema_version` 由 3 → 4（两处硬编码 `3`：`migratePromptModules` 末尾赋值、`promptNeedsMigration` 判定，均改为 `4`）。
- **关键顺序**：`validateInplace` 的 Zod 解析会剥离 schema 中已移除的 `chat_filter_regexes`，因此必须在 `validateInplace` 之前捕获旧值：
  ```typescript
  const existing = _.get(extension_settings, setting_field);
  const legacyRegexes = _.get(existing, 'prompt_rules.chat_filter_regexes', []); // 必须在 validateInplace 前
  const validated = validateInplace(GlobalSettings, existing);
  ```
- 在 `migratePromptModules` 增加 `version < 4` 分支（函数签名扩展为接收 `legacyRegexes`，或另设独立迁移函数），把旧 `string[]` 转成 `{ type: 'regex', pattern }` 规则；仅在 `chat_filter_rules` 为空时填充，避免覆盖用户新数据。

## 过滤逻辑（src/core/generator.ts）
在 `buildChatHistory` 中，把现有 `for (const pat of patterns)` 正则循环替换为按规则类型分发。新增局部 `escapeRegExp` 辅助函数：

```typescript
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rules = gs.settings.prompt_rules.chat_filter_rules ?? [];
for (const rule of rules) {
  try {
    if (rule.type === 'tag') {
      if (!rule.start || !rule.end) continue;                       // 头/尾任一为空则跳过
      const re = new RegExp(escapeRegExp(rule.start) + '[\\s\\S]*?' + escapeRegExp(rule.end), 'g');
      content = content.replace(re, '');
    } else {
      if (!rule.pattern) continue;
      content = content.replace(new RegExp(rule.pattern, 'gs'), '');
    }
  } catch {
    console.warn('[choice] 无效过滤规则:', rule);
  }
}
```
- 保留既有行为：过滤后 `content.trim()` 为空则跳过整条消息；空规则数组时零开销。

## UI（src/components/PromptEditor.vue）
在 `choice-filter-body` 内，把现有 `v-for="(pat, idx) in rules.chat_filter_regexes"` 的单输入框行，替换为按 `rules.chat_filter_rules` 渲染的统一规则行：
- 每行一个类型下拉（`标签匹配` / `正则表达式`）绑定 `rule.type`。
- `rule.type === 'tag'`：两个输入框（占位 `标签头`、`标签尾`），分别绑 `rule.start` / `rule.end`。
- `rule.type === 'regex'`：一个输入框（占位 `正则表达式`），绑 `rule.pattern`。
- 删除按钮沿用 `removeRegexRule(idx)`（可重命名 `removeFilterRule`）。
- 底部按钮 `新增正则规则` 改为 `新增过滤规则`，`addRegexRule` 改为 `addFilterRule`，新增默认 `{ type: 'tag', start: '', end: '' }`。
- 说明文字更新为同时覆盖两种方式（如"过滤聊天记录中标签包裹或匹配正则的内容（如思维链、小剧场、防截断等）"）。

## i18n（i18n/en.json）
- 新增：`标签匹配` → "Tag Match"、`标签头` → "Tag Start"、`标签尾` → "Tag End"、`新增过滤规则` → "Add Filter Rule"。
- 更新说明文字键值。
- 保留：`聊天记录过滤`、`正则表达式`。
- 移除旧键 `新增正则规则`（如无其它引用）。

## 边界与失败模式
- 标签头/尾为空：跳过该条规则，不报错。
- 标签含正则特殊字符：被 `escapeRegExp` 转义，按字面量匹配。
- 嵌套/重复标签：非贪婪匹配最短区间，属可接受行为（不专门处理嵌套）。
- 非法正则：`catch` 后 `console.warn` 跳过，继续后续规则。
- 过滤后内容为空：跳过整条消息，不向 AI 发送空消息。
- 无规则（空数组）：与当前行为完全一致，零开销。

## 验证
1. `pnpm build` 通过（含类型检查）。
2. 浏览器手动确认：
   - 打开设置 → 提示词 → 展开「聊天记录过滤」。
   - 点「新增过滤规则」，确认默认出现标签模式（头/尾两个输入框），类型下拉可切到正则。
   - 添加标签规则：头 `<思考>`、尾 `</思考>`；添加正则规则：`<[^>]+>[\s\S]*?<\/[^>]+>`。
   - 发送消息触发选项生成，确认 AI 收到的聊天历史中已剔除标签包裹内容与正则命中内容。
   - 切换类型、删除规则，确认列表正常增删。
3. 迁移验证：若本地 `extension_settings.choice.prompt_rules.chat_filter_regexes` 存在旧值，刷新后确认被转换为正则规则并显示在列表中。

## 文件变更汇总
| 文件 | 操作 | 说明 |
|------|------|------|
| `src/type/settings.ts` | 编辑 | 新增 `ChatFilterRule`；`PromptRules` 用 `chat_filter_rules` 替换 `chat_filter_regexes` |
| `src/store/global-settings.ts` | 编辑 | 版本 3→4 迁移；`validateInplace` 前捕获旧值并转换 |
| `src/core/generator.ts` | 编辑 | `buildChatHistory` 按规则类型分发过滤；新增 `escapeRegExp` |
| `src/components/PromptEditor.vue` | 编辑 | 统一规则列表 + 类型切换 UI；重命名 `addRegexRule`→`addFilterRule` 等 |
| `i18n/en.json` | 编辑 | 新增/更新 i18n 键 |
