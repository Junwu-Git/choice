import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 与 vite.config.ts 分离：测试只覆盖纯函数模块（不碰酒馆运行时/DOM），
// 不复用主构建的 ST 解析器与 external 配置
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
