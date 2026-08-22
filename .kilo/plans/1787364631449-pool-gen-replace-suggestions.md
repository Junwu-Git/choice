# 条目池 AI 生成：替换建议 + 去重

## 背景与目标
扩展上一版刚建的「条目池 AI 生成」对话框（`PoolGenDialog.vue` + `generatePoolEntries`）。当前 AI 只产出纯新增条目（`string[]`），看不见已有条目，可能生成重复。

新目标：
1. 生成时把**当前注入层**的已有条目喂给 AI，避免产出重复/雷同的新增。
2. AI 可对**弱/重叠/表达不佳**的已有条目提出**替换建议**（指明替换哪条）。
3. 替换建议行与新条目行**颜色区分**；每条可勾选；用户决定注入哪几条（部分或全部），被替换的条目**原地改 text**（保留 id/位置/固定/权重/分类/条件）。

## 已确认决策
- **已有条目范围**：仅 `layer` 下拉选中的那一层的现有条目。AI 只对该层提替换，替换目标一一对应。
- **替换语义**：仅替换目标条目的 `text`，原地保留 id/位置/pinned/weight/category/condition。
- **条目数 N**：本轮返回的建议总数（新增 + 替换合计），按 N 截断。
- **输出格式（行前缀式，非 JSON）**：每行一条。`替换#序号：新文本` 表示替换第 N 条已有（序号对应喂给 AI 的已有列表）；无前缀行视为新增。模型不遵循前缀也不崩（退化为新增）。
- **架构**：store 读取集中在 `src/core/generator.ts`（与 `generateOptions` 同模式）。`generatePoolEntries` 内部读目标层池、解析后**直接解析出目标条目 id + 原文**，返回结构化 item；对话框保持 store-free。

## 数据流与新类型
- `generator.ts` 导出 `export type PoolGenItem = { text: string; replaceTargetId?: string; replaceOriginal?: string }`。
  - `replaceTargetId` 存在 → 替换建议，值为被替换已有条目的 id；`replaceOriginal` 为其原文（供 UI 预览）。
  - 两者都缺 → 新增条目。
- `generatePoolEntries` 新签名：
  ```ts
  generatePoolEntries(params: {
    count: number; requirements: string; includeContext: boolean; layer: PoolLayer;
  }): Promise<PoolGenItem[]>
  ```
  内部：快照 `existing = klona(poolOfLayer(layer))` → 在 user 消息里输出编号列表 → 解析 → 对每个 `替换#N` 把 N(1-based) 映射到 `existing[N-1]`（在范围内则填 `replaceTargetId`/`replaceOriginal`，越界则降级为新增、不填）。
- `PoolGenDialog` 新 emit 契约：
  ```ts
  emit('confirm', {
    layer: PoolLayer;
    additions: PoolEntry[];                          // 新增（新 uuidv4，元数据默认）
    replacements: { id: string; text: string }[];    // 原地改 text
  })
  ```
- `PoolEditor.onGenConfirm` 改为同时处理 additions（push）与 replacements（按 id find 后改 text）。

## 任务清单

### A. `src/core/generator.ts`
1. **导入**：`usePoolSelectorStore` 行补 `type PoolLayer`；`@/store/character-settings` 加 `useCharacterSettingsStore`；`@/type/settings` 加 `PoolEntry`。
2. **新类型**：`export type PoolGenItem = { text: string; replaceTargetId?: string; replaceOriginal?: string }`。
3. **层级池读取**：加 `poolOfLayer(layer): PoolEntry[]`（global→globalStore、character→characterStore、chat→chatStore，仿 `PoolEditor.poolOf`）。
4. **解析器重写**：把现有 `parsePoolEntries(text,count):string[]` 改为 `parsePoolGenItems(text,count):PoolGenItem[]`。复用 `STRIP_REASONING_TAGS_RE` + 代码块剥离 + 列表标记剥离（含十进制 `(?!\d)` 防误吞）。逐行：先剥列表标记 → 匹配 `^替换\s*#?(\d+)\s*[:：]\s*(.+)$` → `{ text: 剥离后的文本, replaceTarget: N }`（N=1-based 序号，仅用于 generator 内映射）；否则 `{ text }`。对前缀后剩余文本也跑一次列表标记剥离。`slice(0,count)`。删除旧 `parsePoolEntries` 导出（改后已无引用，避免死代码）。
5. **系统提示词** `POOL_GEN_SYSTEM_PROMPT` 重写：定位为条目池生成器；说明会收到带序号的已有列表；输出 N 条建议，新增不得与已有重复；对弱/重叠/不佳的已有条目用 `替换#序号：新文本` 提替换；新增间及与已有间切入点/情绪/策略须互异；只输出列表每行一条，不输出思考/标签/解释。
6. **`generatePoolEntries`** 改签名加 `layer`、返回 `Promise<PoolGenItem[]>`。建消息：system=POOL_GEN_SYSTEM_PROMPT；角色描述/性格/场景（同现有同源同法）；includeContext 时 push `buildChatHistory`；user 消息含 `请生成 ${count} 条行动条目建议。\n当前层已有条目：\n${existing.map((e,i)=>`${i+1}. ${e.text}`).join('\n') || '（无）'}\n用户要求：\n${requirements}`。调 `parsePoolGenItems`，再把每个 item 的 `replaceTarget`(1-based) 映射：范围内→`replaceTargetId=existing[N-1].id`、`replaceOriginal=existing[N-1].text`；越界/无→留空（降级新增）。返回 items。abort/timeout/finally/cancel 逻辑不变。

### B. `src/components/PoolGenDialog.vue`
7. **导入**：加 `type PoolGenItem` from `@/core/generator`。无需引入 settings store（store-free）。
8. **state**：`results = ref<PoolGenItem[]>([])`；`selected = ref<Set<number>>(new Set())`（Vue3 checkbox v-model 支持 Set，与 `PoolEditor.selectedIds` 同模式）。
9. **`doGenerate`**：传 `layer: layer.value` 给 `generatePoolEntries`；set `results`；`selected.value = new Set(results.value.map((_,i)=>i))`（默认全选）。
10. **结果区模板**：每行 `<input type=checkbox v-model="selected" :value="i">` + textarea `v-model="results[i].text"` + 删除按钮（删除时同步 `selected.delete(i)` 并重建）。`results[i].replaceTargetId` 存在 → 行加 `is-replace` 类 + 徽章 `替换` + 原文预览 `原条目：${replaceOriginal slice 0..24}`。新条目默认色。
11. **全选切换**：结果区顶部加按钮，`selected.size===results.length ? 全不选 : 全选`（清空或填满 selected）。
12. **`onInject`**：遍历 `[...selected]`，按 `results[i]`：`replaceTargetId` 有 → `replacements.push({id, text: editedText})`；无 → `additions.push(新 PoolEntry)`。空则 return。`emit('confirm', { layer: layer.value, additions, replacements })` + `emit('close')`。注入按钮 `:disabled="selected.size===0 || loading"`。
13. **emit 类型**：confirm 改为 `[payload: { layer: PoolLayer; additions: PoolEntry[]; replacements: { id: string; text: string }[] }]`。
14. **layer 变更清空**：`watch(layer, () => { if (results.value.length) { results.value=[]; selected.value=new Set(); } })`（切换层后旧结果不再对应，强制重生成）。
15. **样式**：`.choice-poolgen-result-row.is-replace { border-left:3px solid #b8943a; background:rgba(184,148,58,0.08) }`；`.choice-poolgen-replace-badge{color:#b8943a;font-size:10px}`；`.choice-poolgen-orig{color:#9a9a9a;font-size:11px}`。复用现有行/textarea/icon 样式。

### C. `src/components/PoolEditor.vue`
16. **`onGenConfirm`** 改签名 `{ additions, replacements, layer }`：`const pool = poolOf(layer)`；`for (const r of replacements) { const t = pool.find(e=>e.id===r.id); if (t) t.text = r.text; }`（原地替换 text，保留 id/元数据）；`pool.push(...additions)`；`showGen.value=false`。

### D. `i18n/en.json`
17. 增键（键=中文）：`替换`→"Replace"、`原条目`→"Original"、`全选`→"Select all"、`全不选`→"Deselect all"。复用现有：`生成/重新生成/生成中…/取消/注入/删除/条目数/生成要求/结合近期对话/注入到/全局/角色/聊天/尚无结果/AI 生成条目`。

## 边界与降级
- 目标层为空 → 无可替换，AI 全输出新增，行为等同旧版（无替换行）。
- `替换#N` 越界（N>已有数）→ 降级为新增（不填 replaceTargetId），无替换徽章，不报错。
- 重 ROLL → 用同一层重新快照（数据未变），结果与 selected 重置。
- 层切换时已有结果 → 清空，强制重生成（避免 id 错位）。
- 关闭对话框 → 仍走 `cancelPoolGen()`（上一版已实现），在途生成被 abort。
- 解析复用与 `parseOptions` 共享的 `STRIP_REASONING_TAGS_RE`，不引入新重复正则。

## 验证
- `pnpm build`（一次性打包，验 TS + 构建）；`pnpm exec eslint src/core/generator.ts src/components/PoolGenDialog.vue src/components/PoolEditor.vue`。`pnpm watch` 常驻勿调。
- **浏览器手动确认**（无热更新，刷新 `http://localhost:8000`）：
  1. 聊天层放 3-4 条条目 → 打开「AI 生成」，层选「聊天」，条目数 6 → 生成 → 出现替换建议行（琥珀色左条 + 「替换」徽章 + 原文预览）与新条目行（默认色）；总数≤6。
  2. 取消勾选其中 2 条 → 注入 → 仅选中项生效：被替换的原条目 text 变为建议文本（id/权重/条件不变，可在条目池核对），新增条目 push 进聊天层。
  3. 「全选/全不选」切换后注入。
  4. 生成后切层 → 旧结果清空。
  5. 空层生成 → 全为新增，无替换行。
  6. 回归：行动选项生成（`generateOptions`）行为不变。

## 范围外
- 对话框内单独折叠展示完整已有条目列表（已有条目仍可在后方 PoolEditor 查看）。
- 替换建议自动填充 category/condition（仅 text）。
- 跨层替换（只允许替换当前注入层）。
