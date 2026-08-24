# 修复提示词模块内容注入 — 实施计划

## 目标

修复模块化提示词编辑器中，世界书条目和聊天历史在 API 请求时未被注入的 bug，同时将世界书构建逻辑切换到复用 ST 原生函数，消除重复实现和维护负担。

## 根因

| 问题 | 位置 | 原因 |
|------|------|------|
| 聊天历史始终为空 | `generator.ts:166` | `m.message` 应为 `m.mes`（ST 消息对象的属性名是 `.mes`） |
| 世界书 redlight 模式静默失败 | `generator.ts:231` | `checkWorldInfo` 的 `WorldInfoBuffer` 对参数调用 `.trim()`，但传入的是 ChatMessage 对象而非字符串 |
| 非 redlight 模式绕过关键词匹配 | `generator.ts:249-264` | `getAllWIEntries` 不做关键词匹配/sticky/cooldown/递归激活 |

## 方案

1. **世界书**：用 ST 的 `getWorldInfoPrompt` 替换自建 `buildWI`/`getAllWIEntries`
2. **聊天历史**：修复 `.message` → `.mes`
3. **Persona**：保持现状（`window.power_user.persona_description`）
4. **废弃设置**：`redlight_mode`、`ejs_compat` 保留在 schema 中（向后兼容），但逻辑不再使用

## 任务列表

### 任务 1：修复聊天历史属性名

**文件**：`src/core/generator.ts`

在 `buildChatHistory` 函数中（约第 166 行）：

```typescript
// 修改前
const c = m.message ?? '';

// 修改后
const c = m.mes ?? '';
```

验证点：生成选项后，`[Choice] 消息数组` 日志中 `聊天历史条数` 应 > 0。

---

### 任务 2：替换世界书构建逻辑

**文件**：`src/core/generator.ts`

#### 2.1 更新导入

```typescript
// 修改前
import { checkWorldInfo, loadWorldInfo, selected_world_info } from '@sillytavern/scripts/world-info';

// 修改后
import { getWorldInfoPrompt, selected_world_info } from '@sillytavern/scripts/world-info';
```

#### 2.2 删除 `getAllWIEntries` 函数（第 184-213 行）

该函数不再需要。

#### 2.3 删除 `WIBuckets` 类型和第 224-277 行的 `buildWI` 函数

替换为新的 `buildWI` 函数：

```typescript
const buildWI = async (): Promise<WIBuckets> => {
  const empty: WIBuckets = { before: '', after: '', anBefore: '', anAfter: '', em: '', atDepth: '' };
  try {
    const ctx = window.SillyTavern?.getContext?.();
    const chatArr: any[] = ctx?.chat ?? [];
    // 将 ChatMessage 对象转为字符串数组（WorldInfoBuffer 期望 string[]）
    const chatStrings = chatArr.map((m: any) => m?.mes ?? '');
    const maxCtx = ctx?.maxContext ?? 1000000;

    const result = await getWorldInfoPrompt(chatStrings, maxCtx, false, {
      trigger: 'normal',
      personaDescription: (window as any).power_user?.persona_description ?? '',
      characterDescription: ch?.data?.description ?? '',
      characterPersonality: ch?.data?.personality ?? '',
      characterDepthPrompt: '',
      scenario: ch?.data?.scenario ?? '',
      creatorNotes: '',
    });

    return {
      before: result.worldInfoBefore ?? '',
      after: result.worldInfoAfter ?? '',
      anBefore: (result.anBefore ?? []).join('\n'),
      anAfter: (result.anAfter ?? []).join('\n'),
      em: (result.worldInfoExamples ?? []).map((e: any) => e?.content ?? '').filter(Boolean).join('\n'),
      atDepth: (result.worldInfoDepth ?? []).flatMap((d: any) => d?.entries ?? []).filter(Boolean).join('\n'),
    };
  } catch (err) {
    console.error('[Choice] buildWI failed', err);
    return empty;
  }
};
```

注意：需要从 `characters` 和 `this_chid` 获取当前角色信息作为 `globalScanData`，提升世界书匹配精度。

#### 2.4 更新 `buildMessages` 调用

```typescript
// 修改前（第 88-90 行）
const wiBuckets = wi.enabled
    ? await buildWI(wiChat.excluded_entries, wi.redlight_mode, wi.ejs_compat)
    : null;

// 修改后
const wiBuckets = wi.enabled
    ? await buildWI()
    : null;
```

`buildWI` 不再需要参数，`excluded_entries` 的处理方式改为在调用 `getWorldInfoPrompt` 之前通过 `applyWIExcl` 控制 `selected_world_info`（该逻辑已在 `generateOptions` 中通过 `applyWIExcl` 处理）。

---

### 任务 3：清理废弃设置的引用

**文件**：`src/type/settings.ts`

`redlight_mode` 和 `ejs_compat` 字段保留在 `WorldInfoGlobalSettings` schema 中（向后兼容，避免解析旧数据失败），但添加注释标记为 deprecated。

**文件**：`src/components/` 中引用 `redlight_mode`/`ejs_compat` 的设置 UI

若存在对应的设置 UI 开关，移除或标记为废弃。

---

### 任务 4：构建验证

```bash
pnpm build
```

确保无类型错误和编译错误。

---

## 风险

| 风险 | 缓解 |
|------|------|
| `getWorldInfoPrompt` 的 `EMEntries`/`WIDepthEntries` 内部结构可能与假设不同 | 在 `buildWI` 中保持 `.map()`/`.flatMap()` 的容错链，`filter(Boolean)` 兜底 |
| 世界书预算受 ST 全局设置控制，可能与插件预期不符 | 这是预期行为—复用 ST 的逻辑意味着遵守 ST 的预算设置 |
| `globalScanData` 传入角色信息后，世界书匹配范围变大，可能激活更多条目 | 这是正向改进，更多条目激活意味着更准确的上下文 |