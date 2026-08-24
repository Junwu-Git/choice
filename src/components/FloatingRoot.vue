<template>
  <FloatingSettings />
  <FloatingBubble v-if="ui.floating_enabled" />
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import FloatingSettings from '@/components/FloatingSettings.vue';
import FloatingBubble from '@/components/FloatingBubble.vue';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);
</script>
