# Changelog

## v0.0.2 (2026-08-27)

### 核心功能
- 主题系统重构：实色三层配色，ST 跟随模式（`auto`/`st`/`dark`/`light` 四模），对比度守卫
- 条目池数据模型重构：PoolEntry `text` → `type` + `content` + `rule` 三字段
- 条目池导入导出：合并/替换双模式，单键导出 JSON
- 润色/选项生成 prompt 灵活化：去掉死板模板，精简规则
- 柏宝书提示词标签化：`baibai_summary` / `baibai_state` 模块，开关控制
- 润色计数：`enrich_count` 改为 string 类型，支持 `"4"` 或 `"3-6"` 区间，空值返回 0

### UI
- 原生控件样式接管（`global.css`），保持与 ST 主题一致
- API 编辑器交互优化
- 模块计数修复（柏宝书过滤后计数准确）
- 字体一致性：硬编码字号替换为 `--choice-text-*` 设计令牌
- 聊天记录过滤默认折叠

### 修复
- 贴边气泡弹跳修复 + 面板出界修复
- 固定条目溢出策略从配置中移除 `pinned_follows_condition`
- 旧数据迁移：`text`→`type`、`enrich_count` number→string、`theme`→`theme_mode`、`entry_ids`→`entries`

## v0.0.1 (2026-08-26)

### 核心功能
- 行动选项异步生成：独立 API 调用，不影响主回复
- 条目池总条目库 + 配置架构，支持聊天/角色/默认三层绑定
- 提示词模块化编辑器：拖拽排序、复制、删除、恢复
- 悬浮球状态指示器：Idle/Generating/Disabled 状态，长按菜单，边缘吸附
- 输入润色：AI 改写用户输入为多个版本
- 世界书注入：复用 ST 原生 `getWorldInfoPrompt`
- AI 生成条目池：批量生成候选条目
- 聊天记录过滤：标签/正则规则分组

### UI
- 设计令牌体系：统一间距/字号/z-index 变量
- 悬浮球状态机改造、FloatingContextMenu
- 选项面板支持 compact 模式
- 新手指南页面
- 响应式布局（ResizeObserver，~380px 兼容）

### 修复
- 世界书注入预算问题（maxCtx 从 8192 放宽到 128000）
- 选项解析改为 JSON 格式，消除正则解析不稳定
- 思维链标签剥离正则修复
- 标题正则空格匹配（兼容全角/半角）
- 按钮竖向排列修复
- 提示词模块迁移（schema_version 0→16）