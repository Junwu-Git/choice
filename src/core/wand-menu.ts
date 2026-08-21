import { openSettings } from '@/core/floating-state';

const MAX_POLLS = 30;
const POLL_INTERVAL = 200;

export function initWandMenu() {
  let pollCount = 0;
  const interval = setInterval(() => {
    pollCount++;
    const $menu = $('#extensionsMenu');
    if ($menu.length) {
      clearInterval(interval);
      createWandEntry($menu);
    } else if (pollCount >= MAX_POLLS) {
      clearInterval(interval);
      console.warn('[Choice] 魔法棒菜单容器 #extensionsMenu 未在 %d 秒内出现，已放弃注入', (MAX_POLLS * POLL_INTERVAL) / 1000);
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
      <div class="fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton"></div>
      <span>${t`行动选项`}</span>
    </div>
  `);
  $entry.on('click', () => {
    openSettings();
    $('#extensionsMenu').hide();
  });
  $container.append($entry);
}