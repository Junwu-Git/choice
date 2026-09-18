import { this_chid } from '@sillytavern/script';
import toastr from 'toastr';
import { getStCharacter } from '@/core/st-character';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { setting_field } from '@/type/settings';
import { KIND_FIELD, type BindKind } from '@/util/character-bindings';

/**
 * 配置绑定切换（聊天级 / 角色卡级）。
 *
 * 为什么独立成模块：PoolEditor 与 PromptEditor 各有一组几乎相同的 bindChat/bindCharacter
 * （仅字段名 config_id↔prompt_config_id、setBinding('pool'↔'prompt') 不同），此前两份拷贝。
 * 收敛后改字段名只改 KIND_FIELD 一处。store 为 Pinia 单例，函数内取用不引入循环依赖
 * （store 不反向依赖本模块；character-bindings.ts 仅持久化通道，不导入 store）。
 *
 * 角色卡写入的红线（见 AGENTS.md）：入口只同步写内存 + store.setBinding 替换设置对象，
 * 落盘统一交给 character-settings store 的 deep watch 单一通道；入口不得显式 persistCharacter，
 * 否则一次点击并发两次 /api/characters/edit（大卡 JSON 序列化 + 后端全量写卡双倍开销，
 * 「绑定卡顿」根因）。严禁用 saveCharacterDebounced（表单旧 json_data 快照会覆盖刚写的内容，
 * 「绑定无效」根因）。
 */

/** 切换「聊天级绑定」：点同一配置再点取消（置 null），不同配置切换。
 *  configId 可空（无选中配置时按钮本不渲染）：与 null 比较后置 null，行为与原内联逻辑一致 */
export function toggleChatBinding(kind: BindKind, configId: string | null): void {
  const field = KIND_FIELD[kind];
  const chatStore = useChatSettingsStore();
  chatStore.settings[field] = chatStore.settings[field] === configId ? null : configId;
}

/** 切换「角色卡级绑定」：写内存角色卡 data.extensions[setting_field][field] + store.setBinding。
 *  无当前角色时提示不绑定（store watch 对 this_chid 为空会静默跳过写卡，造成「绑定无效」，
 *  故 guard + 按钮禁用双保险）。落盘统一由 character-settings store deep watch 排队，
 *  入口不显式 persistCharacter（见模块注释红线） */
export function toggleCharacterBinding(kind: BindKind, configId: string | null): void {
  if (!configId) return;
  const field = KIND_FIELD[kind];
  const ch = getStCharacter(this_chid);
  if (!ch) {
    toastr.warning(t`请先在酒馆中选择一个角色卡`);
    return;
  }
  const characterStore = useCharacterSettingsStore();
  const next = characterStore.settings[field] === configId ? null : configId;
  // 同步写内存（ConfigBindings 徽章扫描读 characters 数组，需立即生效）+ store
  // （按钮高亮与「当前生效-角色」立即响应）。
  _.set(ch, ['data', 'extensions', setting_field, field], next);
  characterStore.setBinding(kind, next);
}
