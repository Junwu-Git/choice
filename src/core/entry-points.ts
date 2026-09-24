import toastr from 'toastr';
import { useGlobalSettingsStore } from '@/store/global-settings';

/** 插件可视化入口 key：悬浮球 / 魔棒菜单 / 聊天面板。入口保底护栏的整理维度 */
export type EntryKey = 'floating' | 'wand' | 'chat';

const ENTRY_KEY_LABEL: Record<EntryKey, string> = {
  floating: '悬浮球',
  wand: '魔棒菜单',
  chat: '聊天面板',
};

type UiShape = {
  floating_enabled: boolean;
  wand_menu_enabled: boolean;
  chat_panel_enabled: boolean;
};

function readEnabled(key: EntryKey, ui: UiShape): boolean {
  if (key === 'floating') return ui.floating_enabled;
  if (key === 'wand') return ui.wand_menu_enabled;
  return ui.chat_panel_enabled;
}

function writeEnabled(key: EntryKey, on: boolean, ui: UiShape): void {
  if (key === 'floating') ui.floating_enabled = on;
  else if (key === 'wand') ui.wand_menu_enabled = on;
  else ui.chat_panel_enabled = on;
}

/** 当前开启的入口数（悬浮球/魔棒/聊天面板） */
export function ensureEntryPoint(): number {
  const ui = useGlobalSettingsStore().settings.ui as UiShape;
  return (readEnabled('floating', ui) ? 1 : 0) + (readEnabled('wand', ui) ? 1 : 0) + (readEnabled('chat', ui) ? 1 : 0);
}

/**
 * 设置入口显隐（入口保底护栏）：关闭最后一个开着的入口时拒绝并提示，
 * 保证插件永远至少有一个可视化入口（否则用户无意全关后无从找回）。
 * 返回是否实际生效。写路径一律走本函数（UI 开关/「隐藏悬浮球」菜单），
 * 禁止在组件里直接写 ui.floating_enabled 等字段绕过保底。
 */
export function setEntryVisible(key: EntryKey, on: boolean): boolean {
  const ui = useGlobalSettingsStore().settings.ui as UiShape;
  if (on) {
    writeEnabled(key, true, ui);
    return true;
  }
  // 本次要关的入口本身已是关 → no-op 成功
  if (!readEnabled(key, ui)) return true;
  // 另两个入口都关 → 这是最后一个，阻止关闭
  const otherKeys: EntryKey[] =
    key === 'floating' ? ['wand', 'chat'] : key === 'wand' ? ['floating', 'chat'] : ['floating', 'wand'];
  const anotherOn = otherKeys.some(k => readEnabled(k, ui));
  if (!anotherOn) {
    toastr.warning(
      t`至少需要保留一个入口：${ENTRY_KEY_LABEL[key]} 是最后一个（${ENTRY_KEY_LABEL[otherKeys[0]]} / ${ENTRY_KEY_LABEL[otherKeys[1]]} 均已关闭）`,
    );
    return false;
  }
  writeEnabled(key, false, ui);
  return true;
}
