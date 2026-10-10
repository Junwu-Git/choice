// 世界书相关 @sillytavern 导入隔离层（AGENTS.md：版本敏感酒馆 API 收敛到 src/core/，
// 先例见 st-regex-source.ts / st-character.ts）。WorldInfoEditor 消费的世界书 API 全部经此
// 中转：酒馆改这些导出的签名/形态时只需改这里，组件层不直接依赖酒馆模块。
// world_names / selected_world_info / this_chid 是酒馆模块的 let 活绑定，re-export 保持实时性。
export { this_chid, eventSource, event_types, chat_metadata } from '@sillytavern/script';
export { loadWorldInfo, selected_world_info, world_names, METADATA_KEY } from '@sillytavern/scripts/world-info';
