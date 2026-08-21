import SettingsPanel from '@/components/SettingsPanel.vue';
import { pinia } from '@/pinia';
import { App } from 'vue';

const app = createApp(SettingsPanel);

app.use(pinia);

declare module 'vue' {
  interface ComponentCustomProperties {
    t: typeof t;
  }
}
const i18n = {
  install: (app: App) => {
    app.config.globalProperties.t = t;
  },
};
app.use(i18n);

export function initPanel() {
  const $app = $('<div id="choice-settings">').appendTo('#extensions_settings2');
  app.mount($app[0]);
}
