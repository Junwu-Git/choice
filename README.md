# Tavern Extension Template

SillyTavern 插件模板, 但我更建议你编写[酒馆助手脚本](http://github.com/StageDog/tavern_helper_template)而非酒馆插件. 因为:

- 酒馆助手为消息楼层、消息显示、酒馆生成请求、酒馆变量 (+ 自制的楼层级别变量)、世界书、预设、酒馆正则等均进行了封装, 虽然其他插件也能使用这些[酒馆助手接口](
https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/基本用法/开发其他插件时使用.html), 但在酒馆助手脚本内编写更方便
- 玩家安装脚本仅需几 kb 空间, 但安装插件需要克隆整个仓库
- 你可以利用 jsdelivr 简单做到脚本的自动更新, 不会像插件一样因为酒馆对 git 的处理问题更新失败
- 脚本支持实时修改, 修改脚本后无须手动刷新酒馆网页即可测试更新结果

## 使用方法

### 部署

请点击网页右上角的绿色 `Use this template` 按钮来创建一个基于这个模板的新仓库.

在创建仓库后, 将本仓库克隆到本地 `SillyTavern/public/scripts/extensions/third-party` 中, 这样你的酒馆就安装好了这个插件, 并且你能在仓库里开始编写代码.

然后, 你需要更改 `manifest.json` 和 `package.json` 中的 `<占位符>` 为你想要的名字.

为了让 `.github/workflows/` 中的工作流能正常运行, 你需要在仓库 `Settings -> Actions -> General` 中将 `Workflow permissions` 设置为 `Read and write permissions`, 并勾选 `Allow GitHub Actions to create and approve pull requests`

### 软件要求

你需要先安装有 node 22+ 和 pnpm, 可以参考[实时编写前端界面或脚本的 Cursor 环境配置](https://stagedog.github.io/青空莉/工具经验/实时编写前端界面或脚本/环境准备/). 如果已经安装有 node 22+, 则 pnpm 可以按以下步骤安装:

```bash
npm install -g pnpm
```

然后, 用 pnpm 安装本项目的所有依赖:

```bash
pnpm install
```

### 访问酒馆接口

相比起酒馆文档里给出的 `getContext()` 中寥寥无几的接口, 我更建议你直接能访问酒馆所有代码文件导出的接口. 为此, 模板提供了 `@sillytavern` 这一特殊导入方式, 你可以借此导入酒馆代码文件:

```typescript
import { uuidv4 } from '@sillytavern/scripts/utils';  // 导入 `SillyTavern/public/scripts/utils.js` 中的 uuidv4 函数
```

### 访问酒馆助手接口

此外你可以通过 `TavernHelper` 访问酒馆助手的所有接口. 请参考[酒馆助手文档](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/基本用法/开发其他插件时使用.html)进行配置.

### i18n

要让插件支持英语, 你应该在界面上用 `` t`要显示的文本` `` 来显示文本, 然后在 `i18n/en.json` 中添加对应的映射.

如果要支持更多语言, 则你需要在 `manifest.json` 中添加对应的语言文件映射. 具体请参考[酒馆官方文档](https://docs.sillytavern.app/for-contributors/writing-extensions/#internationalization).

### 第三方库

#### vue、pinia、zod 等

模板默认提供的是使用 vue、pinia、zod 的示例. 尤其是 `store/settings.ts` 中对 pinia 的使用大幅简化了插件配置的存取: **其他地方代码只需要任意使用 `useSettingsStore` 返回的设置, 而设置将及时保存到酒馆存档内**.

此外, 这里有一些 [vue、pinia、zod](https://stagedog.github.io/青空莉/工具经验/实时编写前端界面或脚本/进阶技巧/) 的使用技巧.

#### tailwindcss

本项目虽然支持了 tailwindcss, 但模板中并没有使用. 因为它的一些样式会导致酒馆网页的样式错乱. 如果你需要使用 tailwindcss, 请自行在 `src/global.css` 中添加 `@import 'tailwindcss';` 并修正其导致的样式错误.

此外, 你可以调整 `eslint.config.mjs` 中对 tailwindcss 的配置; 尤其是 eslint-plugin-better-tailwindcss 与 prettier 之间的[冲突问题](https://stagedog.github.io/青空莉/工具经验/实时编写前端界面或脚本/进阶技巧/).

### 打包

酒馆只接收单个 `.js` 文件作为插件入口, 模板将其设定为 `dist/index.js`.

你可以在本地通过 `pnpm build` 将代码打包为 `dist/index.js` 文件, 或用 `pnpm watch` 来持续监听代码变动且打包. 无论哪种方式, 插件都必须刷新酒馆网页才能使用最新代码, 因此我更建议你编写无须刷新网页的[酒馆助手脚本](http://github.com/StageDog/tavern_helper_template)而非酒馆插件.

在本地编写完成后, 你无须手动进行打包来保证代码是最最新的. 模板在 `.github/workflows/bundle.yaml` 中设置了自动打包功能, 当代码被上传到仓库后, 会自动打包为最新结果.

### 修改版本号

你无须手动去文件更改版本号. 模板在 `.github/workflows/bundle.yaml` 中设置了自动更改版本号的功能, 如果你提交的 commit 消息中带有 `[release]` 字样, 则版本号会自动递增. 具体地,

- `[release major]`: 1.0.0 -> 2.0.0
- `[release minor]`: 1.0.0 -> 1.1.0
- `[release]` 或 `[release patch]`: 1.0.0 -> 1.0.1

### 忽略冲突

基于酒馆 UI 插件的项目结构要求, 本项目直接打包源代码在 `dist/` 文件夹中并随仓库上传, 而这会让开发时经常出现分支冲突.

为了解决这一点, 仓库在 `.gitattribute` 中设置了对于 `dist/` 文件夹中的冲突总是使用当前版本. 这不会有什么问题: 在上传后, ci 会将 `dist/` 文件夹重新打包成最新版本, 因而你上传的 `dist/` 文件夹内容如何无关紧要.

为了启用这个功能, 请执行一次以下命令:

```bash
git config --global merge.ours.driver true
```

### 断点调试

目前, windows 上的断点调试存在一定问题: 你如果在 vscode 内对 vue 文件设置断点, 则用 chrome 或 edge 进行断点调试时, 这些断点无法生效.

这疑似是酒馆网页根目录下没有 vite 配置文件造成的, 我还没找到彻底的解决方法, 你可以:

- 安装 Debugger for Firefox 插件和[火狐浏览器](https://www.firefox.com/en-US/channel/desktop/developer/?redirect_source=mozilla-org) (你可以安装[便携版](https://portableapps.com/apps/internet/firefox-developer-portable)然后在 VSCode 设置里指定路径为便携版), 然后使用模板里配置好的 Firefox 调试任务进行调试.
- 在代码中用 `debugger` 触发断点.
- 在浏览器中 f12 手动设置断点.

## 许可证

- [Aladdin](LICENSE)
