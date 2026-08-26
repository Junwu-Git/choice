# Choice — SillyTavern 行动选项插件

为 SillyTavern 角色扮演对话异步生成"行动选项"，供玩家点选后填入/发送。基于 Vue 3 + Pinia + Zod + Vite。

## 功能特性

- **行动选项生成**：单独调用 API 异步生成选项，不影响主回复生成。支持发送/覆盖/尾附三种行为模式
- **条目池管理**：总条目库 + 配置架构，配置可绑定到角色或聊天，优先级为聊天 > 角色 > 默认
- **提示词模块化**：system/user/assistant 模块可拖拽排序、复制、编辑，支持润色专用模块
- **悬浮球**：状态指示器（Idle/Generating/Disabled），长按快捷菜单，拖拽吸附边缘
- **输入润色**：AI 将用户输入改写为多个润色版本供选择
- **世界书注入**：复用 ST 原生 `getWorldInfoPrompt`，支持排除/启用特定书籍
- **AI 生成条目**：调用 API 批量生成条目池候选
- **聊天记录过滤**：标签/正则按规则分组过滤聊天历史

## 安装

```bash
# 克隆到 SillyTavern 插件目录
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/Junwu-Git/choice.git
```

在酒馆扩展管理面板中启用 Choice 插件，刷新页面即可。

## 快速入门

1. **配置 API**：打开设置 → API 标签，添加 API 配置（地址 + 密钥 + 模型），点击保存
2. **创建条目**：打开设置 → 条目池 → 条目库，添加行动选项条目（或使用 AI 生成）
3. **绑定配置**：创建配置，勾选条目，绑定到当前角色或聊天
4. **生成选项**：在消息下方点击「生成」按钮，AI 生成选项后点击即可填入/发送

## 开发

```bash
pnpm install
pnpm build      # 一次性打包
pnpm watch      # 开发监听模式（需手动刷新浏览器）
```

## 许可证

[Aladdin Free Public License v9](LICENSE)