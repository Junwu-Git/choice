# 新手引导与功能说明 — 修复计划

## 问题
上一轮的实施有两个严重缺陷：
1. **slot 内容为空** — 每个 PageGuide 的 body 里只放了 `<p>{{ t`标题` }}</p>`，和 header 标题一模一样，展开后没有任何实质内容
2. **默认全部折叠** — `default-collapsed="true"` 导致所有说明默认隐藏，用户根本看不到

## 修复方案

### 1. 内容策略：直接在模板里写中文详细说明
不再通过 i18n key 间接引用。每个 PageGuide 的 slot 里直接写 3-5 句中文说明，内容包括：
- 这个页面/功能是干什么的
- 核心概念解释（用通俗语言）
- 常见操作步骤
- 重要注意事项

### 2. 折叠策略：新手引导默认展开，功能说明首次展开
- 新手引导（type="guide"）：`defaultCollapsed: false`，始终展开
- 功能说明（type="desc"）：`defaultCollapsed: false`，首次展开，用户关闭后记住状态

### 3. 修改范围

#### 文件：`src/components/PoolEditor.vue`
- 功能说明：解释配置和条目库的关系，概念互译
- 新手引导：4 步入门流程，蓝框高亮

#### 文件：`src/components/PromptEditor.vue`
- 功能说明：解释模块化提示词系统、角色类型、模块操作

#### 文件：`src/components/ApiEditor.vue`
- 功能说明：解释 API 配置、保存行为、模型拉取

#### 文件：`src/components/BehaviorSettings.vue`
- 功能说明：解释自动生成、输入润色、叙述风格、选项规则

#### 文件：`src/components/WorldInfoEditor.vue`
- 功能说明：解释世界书注入、勾选/排除逻辑

#### 文件：`src/components/AppearanceSettings.vue`
- 功能说明：解释悬浮窗、主题、透明度、字体大小

#### 文件：`src/components/EntryPoolDialog.vue`
- 功能说明：解释条目库概念、分组管理、拖拽、导入/生成

#### 文件：`src/components/PoolGenDialog.vue`
- 功能说明：解释 AI 生成条目的参数和流程

#### 文件：`src/components/ImportEntriesDialog.vue`
- 功能说明：解释粘贴导入的格式和流程

#### 文件：`src/components/ActionOptionsPanel.vue`
- 优化空状态提示，添加配置引导

### 4. 页面内容模板

每个 PageGuide 的 slot 内容结构：

**功能说明 (desc)**：
```
<strong>是什么</strong> — 一句话定位
<strong>怎么用</strong> — 2-3 步操作要点
<strong>注意</strong> — 1 条关键提醒
```

**新手引导 (guide)**：
```
<ol> 四个步骤，每步一句话
小贴士一行
```

### 5. 构建验证
```bash
pnpm build
```
（vue-tsc 的 ~100 个错误均为预存，非本次引入）