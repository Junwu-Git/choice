# 修复世界书问题（第三轮）

## 新增问题

1. **被排除的书展开后无法显示条目**：`refreshAll` 跳过排除书的条目加载，模板也隐藏条目区域
2. **「绿灯关键词触发」开关完全无效**：`WIEntry` 类型缺少 `constant`/`vectorized`；`buildWI` 只检查 `disable`；OFF 时仍走 `getSortedEntries()` 的 ST 原生过滤，无法实现"全量发送"
3. **后台提示词没有聊天记录**：待排查

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/core/generator.ts` | 修复 `WIEntry` 类型；新增 `getAllWIEntries`；修改 `buildWI` 分支逻辑；简化 `buildMessages` 的 `needManual` |
| `src/components/WorldInfoEditor.vue` | 修复排除书的条目加载与显示 |

## 任务清单

### 任务 1：修复 `buildWI` — 正确实现「绿灯关键词触发」的 ON/OFF 行为

**文件**：`src/core/generator.ts`

**1.1 扩展 `WIEntry` 类型**（行 98）：

```ts
// 旧
type WIEntry = { uid: string | number; world: string; content: string; disable: boolean; position: number };

// 新
type WIEntry = { uid: string | number; world: string; content: string; disable: boolean; constant: boolean; vectorized: boolean; position: number };
```

**1.2 新增 `getAllWIEntries` 函数**（放在 `buildWI` 之前）：

```ts
const getAllWIEntries = async (): Promise<WIEntry[]> => {
  const result: WIEntry[] = [];
  const activeBooks = [...(selected_world_info ?? [])];
  const chid = this_chid;
  const charWorld = chid !== undefined && characters[chid] ? characters[chid]?.data?.extensions?.world : undefined;
  if (charWorld && !activeBooks.includes(charWorld)) {
    activeBooks.push(charWorld);
  }
  for (const name of activeBooks) {
    try {
      const data = await loadWorldInfo(name);
      if (data?.entries) {
        for (const entry of Object.values(data.entries) as any[]) {
          result.push({
            uid: entry.uid,
            world: name,
            content: entry.content || '',
            disable: entry.disable || false,
            constant: entry.constant || false,
            vectorized: entry.vectorized || false,
            position: entry.position || 0,
          });
        }
      }
    } catch {
      // ignore load errors
    }
  }
  return result;
};
```

需要新增 import：`import { loadWorldInfo } from '@sillytavern/scripts/world-info';`（检查是否已有）

**1.3 修改 `buildWI` 函数**（行 100-124）：

```ts
const buildWI = async (excl: string[], redlight: boolean, ejs: boolean): Promise<{ before: string; after: string }> => {
  try {
    // ON：走 ST 原生扫描（常量始终激活、普通关键词触发）；OFF：绕过 ST 扫描，全量获取
    let e = redlight ? (await getSortedEntries()) as WIEntry[] : await getAllWIEntries();
    if (excl.length) e = e.filter(x => !excl.includes(`${x.world}::${x.uid}`));
    const b: string[] = [], a: string[] = [];
    for (const x of e) {
      if (redlight && x.disable) continue;      // 过滤已关闭条目
      if (redlight && x.vectorized) continue;   // 过滤向量化条目（用户不需要）
      let t = substituteParams(x.content || '');
      if (ejs && typeof (window as any).ejs?.render === 'function' && t.includes('<%')) {
        try {
          t = (window as any).ejs.render(t, { async: false }) as string;
        } catch (err) {
          console.error('[Choice] EJS render failed', err);
        }
      }
      if (!t) continue;
      (x.position === 1 ? a : b).push(t);
    }
    return { before: b.join('\n\n'), after: a.join('\n\n') };
  } catch (err) {
    console.error('[Choice] buildWI failed', err);
    return { before: '', after: '' };
  }
};
```

**1.4 简化 `buildMessages` 的 `needManual` 逻辑**（行 206-210）：

```ts
// 旧
const needManual = !wi.redlight_mode || wiChat.excluded_entries.length > 0 || wiChat.enabled_books.length > 0;
const w = needManual
  ? await buildWI(wiChat.excluded_entries, wi.redlight_mode, wi.ejs_compat)
  : await buildWI([], true, wi.ejs_compat);

// 新：buildWI 内部已根据 redlight 参数选择路径，无需 needManual 判断
const w = await buildWI(wiChat.excluded_entries, wi.redlight_mode, wi.ejs_compat);
```

### 任务 2：修复排除书的条目加载与显示

**文件**：`src/components/WorldInfoEditor.vue`

**2.1 `refreshAll` 中移除排除书的条目加载跳过**（行 194）：

```ts
// 旧
if (isBookExcluded(book.name)) continue; // 排除的书不加载条目

// 新：删除这行，排除的书也要加载条目
```

**2.2 模板中移除排除书的条目隐藏**（行 38）：

```html
<!-- 旧 -->
v-if="bookExpanded.has(book.name) && !isBookExcluded(book.name) && bookEntries[book.name]"

<!-- 新 -->
v-if="bookExpanded.has(book.name) && bookEntries[book.name]"
```

### 任务 3：聊天记录问题排查

`buildMessages` 第 214 行已包含聊天历史：
```ts
for (const m of buildChatHistory(contextRounds)) msgs.push(m);
```

默认 `context_rounds = 10`。如果用户确认聊天记录缺失，检查 `chat` 数组是否为空、`is_hidden` 是否过滤了所有消息。

## 验证步骤

1. **`pnpm build`**
2. **浏览器验证**：
   - 取消勾选一个世界书 → 展开它 → 确认能显示条目
   - 切换「绿灯关键词触发」ON → 生成选项 → 确认只有 ST 原生扫描的条目（无向量化条目、无禁用条目）
   - 切换「绿灯关键词触发」OFF → 生成选项 → 确认所有条目全量发送（包括禁用/向量化条目）
   - 切换「EJS 兼容」ON → 确认世界书中的 EJS 模板被渲染