# 修复 `.menu_button` 按钮文字竖向排列

## 问题

酒馆全局 `style.css` 中 `.menu_button` 设置 `width: min-content` + `white-space: normal`，导致中文按钮文字在最小宽度下逐字换行，呈现竖向排列。

实测数据：
- "全部展开"：宽 26.6px，高 94px（4 字，每个一行）
- "复制选中到聊天层(0)"：宽 29px，高 200px
- "添加条目"：宽 26.6px，高 94px

## 修复

在 `src/global.css` 中添加两条覆盖规则：

```css
.menu_button {
  width: auto;
  white-space: nowrap;
}
```

- `width: auto` 覆盖全局的 `width: min-content`
- `white-space: nowrap` 覆盖全局的 `white-space: normal`

## 影响范围

`src/global.css` 已在 `src/index.ts:1` 导入，会被打包进 `dist/index.js`，覆盖所有使用 `.menu_button` 的组件：

- `PoolEditor.vue`：全部展开、复制选中到聊天层、添加条目
- `ApiEditor.vue`：保存、取消、添加 API
- `PromptEditor.vue`：载入默认、恢复默认（×2 组）、预览切换
- `WorldInfoEditor.vue`：刷新列表

## 验证

1. `pnpm build` 构建通过
2. 刷新酒馆页面，打开扩展浮窗，确认所有 `.menu_button` 按钮文字横向显示