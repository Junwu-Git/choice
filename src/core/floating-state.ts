export const isSettingsOpen = ref(false);

export const bubbleX = ref(window.innerWidth - 60 - 16);
export const bubbleY = ref(window.innerHeight - 60 - 80);

export const isBubbleContextMenuOpen = ref(false);

export function toggleSettings() {
  isSettingsOpen.value = !isSettingsOpen.value;
}

export function openSettings() {
  isSettingsOpen.value = true;
}

export function closeSettings() {
  isSettingsOpen.value = false;
}
