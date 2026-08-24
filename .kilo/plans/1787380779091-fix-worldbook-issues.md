# 修复世界书三问题：位置策略 + 关键词触发 + 聊天记录

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/core/generator.ts` | 用 `checkWorldInfo` 替代 `getSortedEntries`；按 position 分桶注入；修 `buildChatHistory` 的 chat 引用 |
| `src/components/WorldInfoEditor.vue` | 无改动（UI 不需要显示 position） |

## 任务清单

### 任务 1：导入 `checkWorldInfo`

在 `generator.ts` 顶部，将 `@sillytavern/scripts/world-info` 的导入扩展为：

```ts
import { checkWorldInfo, getSortedEntries, loadWorldInfo, selected_world_info } from '@sillytavern/scripts/world-info';
```

核实方式：在 `world-info.js:4597` 确认 `export async function checkWorldInfo(chat, maxContext, isDryRun, globalScanData)` 存在。

### 任务 2：重写 `buildWI` — 按 position 分桶返回

**删除** 现有 `buildWI` 函数（仅返回 `{ before, after }`），**替换** 为返回多桶结构的新函数：

```ts
type WIBuckets = {
  before: string;        // position 0 (↑Char)
  after: string;         // position 1 (↓Char)
  anBefore: string;      // position 2 (↑AN)
  anAfter: string;       // position 3 (↓AN)
  em: string;            // position 5/6 (↑EM / ↓EM)
  atDepth: string;       // position 4 (@D) — 扁平化为字符串
};

const buildWI = async (excl: string[], redlight: boolean, ejs: boolean): Promise<WIBuckets> => {
  const empty: WIBuckets = { before: '', after: '', anBefore: '', anAfter: '', em: '', atDepth: '' };
  try {
    if (redlight) {
      // ON：调用 ST 原生 checkWorldInfo，做关键词匹配 + position 分桶
      const ctx = window.SillyTavern?.getContext?.();
      const chatArr = ctx?.chat ?? [];
      const maxCtx = ctx?.maxContext ?? 1000000;
      const result = await checkWorldInfo(chatArr, maxCtx, false);
      // EMEntries 是 { position, content } 数组，提取 content
      const emText = (result.EMEntries ?? [])
        .map((e: any) => e.content ?? '')
        .filter(Boolean)
        .join('\n');
      // WIDepthEntries 是 { depth, entries: string[], role } 数组，扁平化
      const depthText = (result.WIDepthEntries ?? [])
        .flatMap((d: any) => d.entries ?? [])
        .filter(Boolean)
        .join('\n');
      return {
        before: result.worldInfoBefore ?? '',
        after: result.worldInfoAfter ?? '',
        anBefore: (result.ANBeforeEntries ?? []).join('\n'),
        anAfter: (result.ANAfterEntries ?? []).join('\n'),
        em: emText,
        atDepth: depthText,
      };
    } else {
      // OFF：绕过 ST 扫描，全量加载所有条目，按 position 分桶
      let e = await getAllWIEntries();
      if (excl.length) e = e.filter(x => !excl.includes(`${x.world}::${x.uid}`));
      const b: Record<number, string[]> = {};
      for (const x of e) {
        let t = substituteParams(x.content || '');
        if (ejs && typeof (window as any).ejs?.render === 'function' && t.includes('<%')) {
          try { t = (window as any).ejs.render(t, { async: false }) as string; }
          catch (err) { console.error('[Choice] EJS render failed', err); }
        }
        if (!t) continue;
        const pos = x.position ?? 0;
        (b[pos] ??= []).push(t);
      }
      // position 4 (atDepth) 和 7 (outlet) 不在 ST 桶中，归入 atDepth 或跳过
      return {
        before: (b[0] ?? []).join('\n\n'),
        after: (b[1] ?? []).join('\n\n'),
        anBefore: (b[2] ?? []).join('\n\n'),
        anAfter: (b[3] ?? []).join('\n\n'),
        em: [...(b[5] ?? []), ...(b[6] ?? [])].join('\n\n'),
        atDepth: (b[4] ?? []).join('\n\n'),
      };
    }
  } catch (err) {
    console.error('[Choice] buildWI failed', err);
    return empty;
  }
};
```

### 任务 3：重写 `buildMessages` — 按 ST 位置策略注入

**当前** `buildMessages` 的注入顺序错误（WI 在角色定义之后）：

```
旧：systemPrompt → desc → personality → scenario → WI before → WI after → chatHistory → user
```

**改为** 遵循 ST 位置策略：

```ts
const buildMessages = async (
  systemPrompt: string,
  userInstruction: string,
  wi: WorldInfoGlobalSettings,
  wiChat: WorldInfoChatSettings,
  contextRounds: number,
): Promise<ChatMsg[]> => {
  const msgs: ChatMsg[] = [];
  // 1. 用户系统提示词
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  // 2. 世界书 before（position 0 ↑Char）— 在角色定义之前
  if (wi.enabled) {
    const w = await buildWI(wiChat.excluded_entries, wi.redlight_mode, wi.ejs_compat);
    if (w.before) msgs.push({ role: 'system', content: w.before });
  }
  // 3. 角色定义
  const ch = this_chid !== undefined ? characters[this_chid] : undefined;
  if (ch?.data?.description) msgs.push({ role: 'system', content: substituteParams(ch.data.description) });
  // 4. 世界书 after（position 1 ↓Char）— 在角色定义之后
  if (wi.enabled) {
    // 复用已计算的 w（上面已 await，但 w 在 if 块内作用域——需提到外层）
    // 见下方修正：w 提到 if(wi.enabled) 外层
  }
  // 5. 角色性格、场景
  if (ch?.data?.personality) msgs.push({ role: 'system', content: substituteParams(ch.data.personality) });
  if (ch?.data?.scenario) msgs.push({ role: 'system', content: substituteParams(ch.data.scenario) });
  // 6-10. AN/EM/Depth
  // 11. 聊天历史
  for (const m of buildChatHistory(contextRounds)) msgs.push(m);
  // 12. 用户指令
  msgs.push({ role: 'user', content: userInstruction });
  return msgs;
};
```

**修正**：`buildWI` 的返回值 `w` 需要提到 `if (wi.enabled)` 外层，避免作用域问题：

```ts
const buildMessages = async (...) => {
  const msgs: ChatMsg[] = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });

  const wiBuckets = wi.enabled
    ? await buildWI(wiChat.excluded_entries, wi.redlight_mode, wi.ejs_compat)
    : null;

  // position 0：角色定义之前
  if (wiBuckets?.before) msgs.push({ role: 'system', content: wiBuckets.before });

  const ch = this_chid !== undefined ? characters[this_chid] : undefined;
  if (ch?.data?.description) msgs.push({ role: 'system', content: substituteParams(ch.data.description) });

  // position 1：角色定义之后
  if (wiBuckets?.after) msgs.push({ role: 'system', content: wiBuckets.after });

  if (ch?.data?.personality) msgs.push({ role: 'system', content: substituteParams(ch.data.personality) });
  if (ch?.data?.scenario) msgs.push({ role: 'system', content: substituteParams(ch.data.scenario) });

  // position 2：AN 之前
  if (wiBuckets?.anBefore) msgs.push({ role: 'system', content: wiBuckets.anBefore });
  // position 5/6：EM
  if (wiBuckets?.em) msgs.push({ role: 'system', content: wiBuckets.em });
  // position 3：AN 之后
  if (wiBuckets?.anAfter) msgs.push({ role: 'system', content: wiBuckets.anAfter });
  // position 4：插入深度（扁平化为 system 消息，注入在聊天历史之前）
  if (wiBuckets?.atDepth) msgs.push({ role: 'system', content: wiBuckets.atDepth });

  for (const m of buildChatHistory(contextRounds)) msgs.push(m);
  msgs.push({ role: 'user', content: userInstruction });
  return msgs;
};
```

### 任务 4：修复 `buildChatHistory` — 用 ST Context API 获取 chat

**当前问题**：`chat` 从 `@sillytavern/script` 导入（`export let chat = []`），可能因 live binding 时序问题拿到空数组。且 `ChatMessage` 类型有 `role` 但代码用 `is_user`（类型定义中不存在）。

**修复**：改用 `window.SillyTavern.getContext().chat`，并优先使用 `role` 判断角色：

```ts
const buildChatHistory = (contextRounds: number): ChatMsg[] => {
  const ctx = window.SillyTavern?.getContext?.();
  const chatArr = ctx?.chat ?? [];
  let msgs = chatArr.filter((m: any) => !m.is_hidden);
  if (contextRounds > 0) msgs = msgs.slice(-contextRounds * 2);
  const h: ChatMsg[] = [];
  for (const m of msgs) {
    if (m.is_system) continue;
    const c = m.message ?? '';
    if (!c) continue;
    // 优先用 role，回退到 is_user
    const role = m.role === 'user' || m.is_user ? 'user' : 'assistant';
    h.push({ role, content: c });
  }
  return h;
};
```

同时新增诊断日志（在 `buildMessages` 返回前）：

```ts
console.log('[Choice] 消息数组', {
  总数: msgs.length,
  聊天历史条数: msgs.filter(m => m.role === 'user' || m.role === 'assistant').length,
  system条数: msgs.filter(m => m.role === 'system').length,
});
```

### 任务 5：移除不再需要的 `getSortedEntries` 导入

`getSortedEntries` 不再被 `buildWI` 直接调用（ON 路径改用 `checkWorldInfo`，OFF 路径用 `getAllWIEntries`）。检查是否还有其他地方引用，若无则从导入中移除。

`getAllWIEntries` 保留（OFF 路径使用）。

## 验证步骤

1. **`pnpm build`**
2. **浏览器验证**：
   - 开启「绿灯关键词触发」→ 生成选项 → 查看 F12 控制台 `[Choice] 消息数组` 日志：
     - 确认 `聊天历史条数 > 0`（修复聊天记录）
     - 确认 `system条数` 合理（不再 6.6 万 token）
   - 关闭「绿灯关键词触发」→ 生成选项 → 确认全量条目发送
   - 在世界书中设置不同 position 的条目 → 确认注入顺序正确（before 在角色定义前、after 在后）
3. **F12 控制台 `[WI]` 日志**：开启绿灯时应看到 ST 原生 WI 扫描日志（关键词匹配过程）

## 风险点

- **`checkWorldInfo` 副作用**：会设置 timed effects 和 AN extension prompt。但扩展的生成是独立 API 调用，不影响 ST 原生生成。`isDryRun=false` 确保 timed-effect 条目正确激活。
- **EJS 渲染**：ON 路径（`checkWorldInfo`）不做 EJS 渲染（ST 原生不做）。OFF 路径保留 EJS 渲染。如果用户需要 EJS + 关键词匹配同时生效，需要后续单独处理。
- **条目级排除**：ON 路径不支持条目级排除（`checkWorldInfo` 返回已格式化字符串，无法按 entry 过滤）。OFF 路径保留条目级排除。书籍级排除仍通过 `applyWIExcl` 在两条路径都生效。
- **`maxContext` 传参**：使用 `ctx.maxContext`，可能基于 ST 配置的模型而非扩展自定义 API 模型。WI budget 可能偏小导致部分条目被截断。如果出现此问题，可改为传大数（如 `1000000`）禁用 budget。