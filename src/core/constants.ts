/**
 * 跨模块共享的展示/分组语义常量（单一事实来源）。
 *
 * 为什么只有这几个：其余同类文案（如 `未分组` 的 UI 展示位）都被 `t\`...\`` 翻译函数包裹，
 * 是 i18n 展示标签而非内部键，提取成非翻译常量会跳过 t 破坏语义，故保留原位。
 * 这里收的是「内部逻辑必须字面相等」的键——分组语义键必须与组件判定/生成逻辑一致，
 * 任何一处硬编码漂移都会导致分组错乱或「已删除」组撞名。
 */

/** 空 category 归组的分组名（stats.ts entryGroups 分组键，持久化展示共用） */
export const CATEGORY_UNGROUPED = '未分组';

/** 已从 master_pool 删除的条目聚合组名（stats.ts entryGroups 末尾固定组） */
export const CATEGORY_DELETED = '已删除';

/** 已删除组的唯一渲染键前缀：用户自定义分类可能与「已删除」重名，须前缀区分防 Vue key 冲突 */
export const DELETED_GROUP_PREFIX = 'del:';

/** 空值展示占位（统计页数字/文本缺省态；避免各处硬编码 '–'） */
export const EMPTY_DISPLAY = '–';

/**
 * 选项面板/悬浮球弹窗正文字号缩放系数（ui.option_font_size 与
 * ui.floating_option_font_size 共用）。容器设 `--choice-option-font-scale`，
 * global.css 在 --choice-text-sm 之上再乘它。聊天面板与悬浮球两处字号档若各自
 * 硬编码数字会漂移，故收在此单一来源
 */
export const OPTION_FONT_SCALE: Record<'small' | 'medium' | 'large', number> = {
  small: 0.85,
  medium: 1,
  large: 1.2,
};
