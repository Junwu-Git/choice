# 提示词结构优化 & 润色/选项通用化

## 已实现（全部）

| # | 变更 | 状态 |
|---|------|------|
| 1 | 通用化 `DEFAULT_SYSTEM_PROMPT` | ✅ |
| 2 | 润色包含 `core_rules` | ✅ |
| 3 | `option_only` 在 `buildMessages()` 生效 | ✅ |
| 4 | 移除 `send_prefill` 死代码 | ✅ |
| 5 | 润色提示词改用 `{{input}}` 变量 | ✅ |
| 7a | 通用化 `THINKING_PROMPT_CONTENT` | ✅ |
| 7b | 通用化 `ASSISTANT_THINKING_CONTENT` | ✅ |
| 7c | 从 `ENRICH_SKIP_IDS` 移除思考链模块 | ✅ |
| 7d | `mergeAdjacentMessages` 移入 `buildMessages()` | ✅ |
| 7e | 更新 `settings.json` 思考链内容 | ✅ |
| 8a | 通用化 `assistant_ack` + 移除 `ENRICH_SKIP_IDS` | ✅ |
| 8b | `enrich_prompt` 模块 role 改为 user | ✅ |

## 待实现

### 9. 润色提示词加入 `{{count}}` 变量

**问题**：`enrich_count` 在 `enrichCtx.count` 中已传入，但 `enrich_prompt` 模块内容未使用 `{{count}}`，始终写"多个"。

**文件**：

| 文件 | 变更 |
|------|------|
| `src/type/settings.ts:211` | `enrich_prompt` 模块 content 中 `"多个"` → `"{{count}} 个"` |
| `src/core/enrich-input.ts:8` | `DEFAULT_ENRICH_PROMPT` 同上 |
| `data/default-user/settings.json:1201` | 存储内容同上 |

### 10. 润色面板增加退出按钮

**问题**：润色完成后无退出方式，用户无法切回选项生成界面。

**文件**：`src/components/ActionOptionsPanel.vue`

在工具栏中增加关闭按钮，当 `enrichMode && !enrichLoading` 时显示：

```html
<button v-if="enrichMode && !enrichLoading" class="choice-panel-btn" 
        title="返回选项" @click="panelStore.exitEnrichMode()">
  <i class="fa-solid fa-xmark"></i>
</button>
```

插入位置：`enrichLoading` 取消按钮之后、`!enrichMode` 生成按钮之前。

## 验证

1. `pnpm build` 确保无编译错误
2. 刷新酒馆 → 修改润色条数 → 润色 → Network 面板确认提示词中包含 `{{count}}` 替换后的实际数字
3. 润色完成后 → 确认面板出现关闭按钮 → 点击关闭 → 切回行动选项界面