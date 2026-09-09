import { openSettings } from '@/core/floating-state';
import { pinia } from '@/pinia';
import { useGlobalSettingsStore } from '@/store/global-settings';

const MAX_POLLS = 30;
const POLL_INTERVAL = 200;

/** 按 ui.wand_menu_enabled 同步魔棒入口显隐。容器可能尚未注入（订阅先于
 *  createWandEntry 完成触发、或 ST 重建了 #extensionsMenu），空安全跳过；
 *  入口重复注入由 createWandEntry 的幂等检查兜底，本函数只负责显隐 */
function syncWandEntryVisibility(enabled: boolean) {
  const $container = $('#choice_wand_container');
  if (!$container.length) return;
  $container.toggle(enabled);
}

/** 设置任何字段变化都触发入口显隐同步（开关在 AppearanceSettings 里切） */
function subscribeWandMenuSetting() {
  const gs = useGlobalSettingsStore(pinia);
  gs.$subscribe(() => {
    syncWandEntryVisibility(gs.settings.ui.wand_menu_enabled);
  });
}

export function initWandMenu() {
  // 先按当前设置同步一次，覆盖"容器已存在、设置恰好此刻变更"的启动竞态
  subscribeWandMenuSetting();
  syncWandEntryVisibility(useGlobalSettingsStore(pinia).settings.ui.wand_menu_enabled);

  let pollCount = 0;
  const interval = setInterval(() => {
    pollCount++;
    const $menu = $('#extensionsMenu');
    if ($menu.length) {
      clearInterval(interval);
      createWandEntry($menu);
    } else if (pollCount >= MAX_POLLS) {
      clearInterval(interval);
      console.warn(
        '[Choice] 魔法棒菜单容器 #extensionsMenu 未在 %d 秒内出现，已放弃注入',
        (MAX_POLLS * POLL_INTERVAL) / 1000,
      );
    }
  }, POLL_INTERVAL);
}

function createWandEntry($menu: JQuery<HTMLElement>) {
  if ($menu.find('#choice_wand_container').length) {
    return;
  }
  const $container = $('<div id="choice_wand_container" class="extension_container">').appendTo($menu);
  const $entry = $(`
    <div class="list-group-item flex-container flexGap5">
      <div class="fa-solid fa-chess extensionsMenuExtensionButton"></div>
      <span>${t`行动选项`}</span>
    </div>
  `);
  $entry.on('click', () => {
    openSettings();
    $('#extensionsMenu').hide();
  });
  $container.append($entry);
  // 注入完成后立刻按当前开关定显隐（订阅可能在菜单未注入时已触发过，这里补一次）
  syncWandEntryVisibility(useGlobalSettingsStore(pinia).settings.ui.wand_menu_enabled);
}
