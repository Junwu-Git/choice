# 拖拽排序 Bug 修复

## 问题一：分组条目拖空后分组消失

**根因**: 分组由 `groupedEntries` 从 `masterPool` 的 `category` 派生。条目全部拖走后，分组不再存在于 `groupedEntries` 中。`pendingGroups` 只在"新建分组"时添加，没有在拖空时同步。

**修复**: `EntryPoolDialog.vue` 的条目 `onEnd` 回调中，跨组拖拽后检查源分组是否为空，为空则加入 `pendingGroups`。

## 问题二：跨分组拖拽需要两次才能拖入

**根因**: `v-show="false"` → `display: none`，元素在布局中高 0。SortableJS 的 `elementFromPoint()` 找不到隐藏元素作为 drop target。`dragenter` 展开分组后，SortableJS 在当前拖拽周期内不会重新扫描新出现的 drop target。

**修复**: 
- 模板：`v-show` 改为 `:class` + 折叠 CSS（`min-height: 4px; overflow: hidden`）
- CSS：`.choice-epool-group-body.is-collapsed { min-height: 4px; padding: 0 0 0 16px; gap: 0; overflow: hidden; }`
- 折叠状态下仍有 4px 高度，SortableJS 可识别。`dragenter` 展开后正常拖入。

## 改动清单

| 文件 | 操作 |
|------|------|
| `src/components/EntryPoolDialog.vue` | 模板: `v-show` → `:class` + `is-collapsed`；脚本: `onEnd` 中加空分组逻辑 |
| `src/components/EntryPoolDialog.vue` | CSS: 新增 `.is-collapsed` 样式 |

## 验证

1. `pnpm build` 通过
2. 浏览器中：
   - 拖空一个分组 → 空分组保留，显示"暂无条目"
   - 跨分组拖拽 → 一次拖入成功，目标自动展开