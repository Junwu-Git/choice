/**
 * 时间工具（展示格式化与导出时间戳）。
 *
 * 为什么独立成模块：绝对时间格式化（YYYY/MM/DD HH:mm）此前在 Statistics.vue 存在两份
 * 几乎相同的实现（updatedAtText computed / historyTimeTitle），导出时间戳
 * `new Date().toISOString()` 散落在 Statistics/PromptEditor/EntryPoolDialog 三处导出逻辑。
 * 集中后修一处即全局生效。相对时间 timeAgo 保持在各组件原位——它是 t 包裹的 i18n 文案，
 * 且仅 Statistics.vue 单文件使用，无跨文件漂移风险。
 */

/** 两位补零（时间/日期展示与导出文件名时间戳共用；单一事实来源，勿在组件内再定义） */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 本地时区 `YYYY/MM/DD HH:mm`（紧凑绝对时间，用于统计页 tooltip/历史面板） */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 导出文件的时间戳标记：ISO 字符串（JSON 导出 payload 的 exportedAt 字段） */
export function isoTimestamp(): string {
  return new Date().toISOString();
}
