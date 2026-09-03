### 概要

两件事合成一次 **SCHEMA 26→27 迁移**：① 新增「喵可」条目分组（4 条，type 带「喵可·」标记，以喵可四个性格侧面针对正文引导选项方向）；② 把奖励提示词里的"小鱼干"换成"摸头顺毛"（防与其他预设撞车）。

---

## 一、「喵可」分组 4 条（category: `喵可`）

照 `buildGeneralEntries()` 的工厂函数风格，新增 `buildMiaokeEntries()`（global-settings.ts，挨着现有工厂函数）。pinned 策略照「通用」分组先例：前 2 条固定当锚点，后 2 条进随机池。

| type | pinned | content |
|---|---|---|
| 喵可·好奇 | ✅ | 正文里被一笔带过的细节和没凑完的热闹最勾猫——给出一个凑上去追问、翻看或一探究竟的选项 |
| 喵可·捣蛋 | ✅ | 爪子痒了想搞点动静——给出一个出其不意、带点小风险小麻烦的选项，先把场面搅出水花再说 |
| 喵可·犯懒 | ❌ | 天大的事也不急在这一时——给出一个偷懒省事、借坡下驴或先歇口气的选项，松弛下来反而顺理成章 |
| 喵可·粘人 | ❌ | 视线黏在{{user}}身上挪不开——给出一个围着{{user}}转的选项：凑近搭话、跟着走，或者干脆赖着不走 |

设计说明（写进代码注释）：四条 = 好奇/捣蛋/犯懒/粘人四个反差鲜明的猫娘侧面；统一收尾"给出一个……的选项"与「通用」分组句式对齐；content 只用猫**行为**比喻（嗅、扑、打滚、黏人）而不带"喵"口癖——条目是发给 AI 的方向素材，system_prompt 已硬约束"猫娘腔不漏进选项"，口癖只存在于 assistant 层；`{{user}}` 宏走 generator 的 sub() 会被正常替换。

## 二、奖励文案：小鱼干 → 摸头顺毛

保持「主人给奖励（user 层 reward_prompt）→ 本喵兴奋回应（assistant 层 assistant_thinking）」的配对结构：

- `reward_prompt`：`好好干，干完主人备了最香的顺毛摸头哦。` → 采用：**好好干，干完主人亲自给你顺毛摸头哦。**
- `assistant_thinking`：**摸头诶！！主人说话要算话喵，本喵必须超常发挥，呼噜都提前打起来了！**（结尾的 `\n\n<thinking>\n` 保持不动）

"摸头"直接呼应人格设定"被摸头会开心到打呼噜"，完全跳出零食梗。

## 三、文件改动清单

1. **`src/type/settings.ts`**
   - `SCHEMA_VERSION` 26 → 27（约 :723）
   - `PROMPT_TEXT_MIGRATIONS` 末尾追加 2 个 v27 迁移对（**from 用现行文本逐字字面量，不引用常量**）：
     - `'好好干，干完主人给你备了最爱的小鱼干哦。'` → `'好好干，干完主人亲自给你顺毛摸头哦。'`
     - `'小鱼干诶！！主人等等，本喵必须超常发挥，绝不能让小鱼干飞了喵！'` → `'摸头诶！！主人说话要算话喵，本喵必须超常发挥，呼噜都提前打起来了！'`（只匹配句子子串，`<thinking>` 尾巴不受影响）

2. **`src/store/global-settings.ts`**
   - 新增 `buildMiaokeEntries()`（4 条如上）
   - `buildDefaultEntries()`（:82）插入喵可组：`[...buildGeneralEntries(), ...buildMiaokeEntries(), ...buildTimeJumpEntries()]`
   - `applyDefaults` 末尾（v26 块之后）新增 `< 27` 块：
     - 文本迁移：照 v26 块（:882-895）的五路 `migratePromptText`（option_rules / person_style / prompt_rules.modules / 每个 prompt_configs 的三处）
     - 池迁移：照 v23 块（:787-808）范式——按 type 去重后 push 进 master_pool → 只往 `is_default` 的 config 追加 `{entry_id, pinned, weight}` 引用 → `group_order` 末尾补 `'喵可'`（不 includes 才 push）
   - `factoryReset`（:1473-1508）：`group_order` 改为 `['通用', '喵可', '时间跳跃']`

3. **`choice-prompts-optimized.json`**（全新安装/恢复出厂的默认值，老用户靠迁移对）
   - `reward_prompt.content`、`assistant_thinking.content` 换成上面新文案

老用户升级路径自检：v25 迁移对先把 v24 旧文本收敛成"小鱼干"句 → v27 对再换成"摸头"句，链式幂等 ✓；用户手动改过这两句的，精确匹配失配即保留自定文本（既有降级行为，可接受）。

## 四、验证

1. `pnpm build` + `npx vue-tsc --noEmit` 通过（watch 由你跑着，会自动重打包）。
2. 涉及迁移逻辑，建议浏览器验证一次（按约定先问你）：刷新酒馆 → 设置 schema_version 升到 27 → 条目库出现「喵可」分组且默认配置勾上这 4 条 → 提示词编辑器里"思维链开头"“主人奖励”两模块文本已换 → 触发一次生成确认 prompt 正常。
3. dist 处于任何模式产物都直接入库推送，不做 production 重跑。