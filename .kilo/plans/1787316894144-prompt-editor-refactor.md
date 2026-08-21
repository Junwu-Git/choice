# 重构提示词界面：三字段 + 载入/恢复默认

## 目标

将"提示词"标签页从 6 个字段简化为 3 个字段，消除前端字段与硬编码规则之间的重复冲突。

## 消息序列（最终态）

```
system: [破限 - 用户可编辑]                  ← 第 1 条 system
system: [角色描述]
system: [角色性格]
system: [角色场景]
system: [世界书 before]
system: [世界书 after]
[聊天历史]
user: [buildUserInstr - 生成指令]
system: [rule - 用户可编辑]                  ← 倒数第三
system: [THINKING_PROMPT - 硬编码]            ← 倒数第二（仅 send_prefill 时）
assistant: [OPTIONS_PREFILL - 硬编码]         ← 倒数第一（仅 send_prefill 时）
```

## 前端字段映射

| 字段 | 消息位置 | 默认值 | 说明 |
|------|---------|--------|------|
| 破限 | 第 1 条 system | `DEFAULT_SYSTEM_PROMPT`（合并旧 4 个 DEFAULT） | 含 `{{count}}`/`{{pinned}}`/`{{pool_selected}}`/`{{user}}` 占位符 |
| rule | 倒数第三 system | `DEFAULT_CORE_RULES`（14 条） | 含 `{{user}}` 占位符 |
| 上下文轮数 | 控制 `buildChatHistory` 截取 | 10 | 不变 |

字段默认值在 schema 中为 `''`（空字符串），用户点击「载入默认」按钮后才填入默认文本。

## 任务清单

### 任务 1：`src/type/settings.ts` — Schema 重构

1. **新增 `DEFAULT_CORE_RULES` 常量**（从 `generator.ts` 的 `CORE_RULES` 搬过来，去掉 `{{user}}` 外的硬编码占位符标记）
2. **新增 `DEFAULT_SYSTEM_PROMPT` 常量**：合并 `DEFAULT_AI_PERSONA + '\n\n' + DEFAULT_PERSON + '\n\n' + DEFAULT_PROMPT_OUTPUT_FORMAT + '\n\n' + '每条选项长度:80字左右' + '\n\n' + DEFAULT_PROMPT_EXTRA`
3. **重构 `PromptRules` schema**：
   - 删除字段：`ai_persona`、`person`、`output_format`、`option_length`、`extra_requirements`
   - 新增字段：`system_prompt`（`z.string().default('')`）、`core_rules`（`z.string().default('')`）
   - 保留字段：`context_rounds`
4. **Bump `SCHEMA_VERSION`**：6 → 7
5. 保留旧的 `DEFAULT_*` 常量（供「载入默认」按钮使用），导出新增的 `DEFAULT_SYSTEM_PROMPT` 和 `DEFAULT_CORE_RULES`

### 任务 2：`src/core/generator.ts` — 生成逻辑更新

1. **删除 `CORE_RULES` 常量**（已搬到 `settings.ts`）
2. **更新 `systemRules` 组装逻辑**：
   ```ts
   // 旧：sp.push(rules.ai_persona), sp.push(rules.person), ...
   // 新：
   const systemPrompt = rules.system_prompt
     ? substituteParams(sub(rules.system_prompt, c))
     : '';
   ```
3. **更新 `CORE_RULES` 推送**：
   ```ts
   // 旧：messages.push({ role: 'system', content: substituteParams(CORE_RULES) });
   // 新：
   if (rules.core_rules) {
     messages.push({ role: 'system', content: substituteParams(sub(rules.core_rules, c)) });
   }
   ```
   注意：`sub()` 先处理 `{{count}}`/`{{pinned}}`/`{{pool_selected}}`，`substituteParams()` 再处理 `{{user}}` 等 ST 宏。
4. **`buildMessages` 参数重命名**：`systemRules` → `systemPrompt`（纯重命名，逻辑不变）
5. **`buildUserInstr` 不变**（仍由 `sub()` 处理）
6. **`THINKING_PROMPT` 和 `OPTIONS_PREFILL` 不变**（硬编码，与解析逻辑强绑定）

### 任务 3：`src/components/PromptEditor.vue` — UI 重构

1. **删除旧字段**：ai_persona、person、output_format、option_length、extra_requirements
2. **新增 3 个字段**：
   ```html
   <!-- 破限 -->
   <label class="choice-field">
     <span>破限 <button @click="loadSystemPrompt">载入默认</button> <button @click="resetSystemPrompt">恢复默认</button></span>
     <textarea v-model="rules.system_prompt" rows="12" placeholder="点击「载入默认」获取推荐提示词" />
   </label>
   <!-- rule -->
   <label class="choice-field">
     <span>规则 <button @click="loadCoreRules">载入默认</button> <button @click="resetCoreRules">恢复默认</button></span>
     <textarea v-model="rules.core_rules" rows="8" placeholder="点击「载入默认」获取推荐规则" />
   </label>
   <!-- 上下文轮数 -->
   <label class="choice-field">
     <span>上下文轮数(0 = 全部历史)</span>
     <input v-model.number="rules.context_rounds" type="number" min="0" />
   </label>
   ```
3. **按钮逻辑**：
   ```ts
   import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CORE_RULES } from '@/type/settings';
   const loadSystemPrompt = () => { rules.system_prompt = DEFAULT_SYSTEM_PROMPT; };
   const resetSystemPrompt = () => { rules.system_prompt = DEFAULT_SYSTEM_PROMPT; };
   const loadCoreRules = () => { rules.core_rules = DEFAULT_CORE_RULES; };
   const resetCoreRules = () => { rules.core_rules = DEFAULT_CORE_RULES; };
   ```
   「载入默认」和「恢复默认」行为相同，但 UI 上分开显示以便用户区分意图。

### 任务 4：`src/store/global-settings.ts` — 迁移逻辑

1. **删除 `OLD_V1_PERSON` 常量**（不再需要）
2. **更新 `applyDefaults`**：
   ```ts
   const applyDefaults = (validated: GlobalSettingsType) => {
     if (validated.pool.length === 0) {
       validated.pool = createDefaultPool();
     }
     // 迁移：旧字段 ai_persona/person/output_format/extra_requirements 不再处理
     // 新字段 system_prompt/core_rules 保持空字符串，让用户自行载入默认
     validated.schema_version = SCHEMA_VERSION;
   };
   ```
3. **移除旧字段的 import**：不再需要 `DEFAULT_AI_PERSONA`、`DEFAULT_PERSON`、`DEFAULT_PROMPT_EXTRA`、`DEFAULT_PROMPT_OUTPUT_FORMAT`

### 任务 5：`i18n/en.json` — 翻译更新

**新增**：
```json
"破限": "System Prompt",
"规则": "Rules",
"载入默认": "Load Default",
"恢复默认": "Restore Default",
"点击「载入默认」获取推荐提示词": "Click 'Load Default' to get recommended prompt",
"点击「载入默认」获取推荐规则": "Click 'Load Default' to get recommended rules"
```

**删除**（不再使用的旧 key）：
- `"行动选项 AI 人设"`、`"行动选项 AI 的身份与职责描述"`
- `"叙述人称"`、`"如:以第二人称叙述,贴合角色语气"`、`"如:以第一人称叙述行动选项,贴合角色语气"`
- `"输出格式说明"`、`"如:每条选项以动词短语开头,简洁明了"`
- `"每条选项字数"`
- `"额外要求"`、`"可用占位符 {{count}} / {{pinned}} / {{pool_selected}}"`
- `"第几人称 / 表达"`

## 迁移策略

- `SCHEMA_VERSION` 6 → 7 触发 `applyDefaults`
- 旧字段（`ai_persona`、`person`、`output_format`、`option_length`、`extra_requirements`）被 Zod `prefault` 自动丢弃
- 新字段（`system_prompt`、`core_rules`）默认为空字符串
- 用户需手动点击「载入默认」获取推荐内容

## 验证

1. `pnpm build` 通过
2. 刷新酒馆 → 设置 → 提示词标签页：显示 3 个字段（破限、规则、上下文轮数），均为空，有占位提示
3. 点击「载入默认」→ 破限和规则字段填充默认文本
4. 点击「恢复默认」→ 字段重置为默认文本
5. 发送消息 → 网络请求中可看到：
   - 第 1 条 system 消息 = 破限内容
   - 倒数第三条 system 消息 = 规则内容
   - 空字段时不发送对应 system 消息