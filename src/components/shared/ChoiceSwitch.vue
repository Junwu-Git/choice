<template>
  <label class="choice-switch" :class="{ 'choice-switch--on': modelValue }" :title="title">
    <input v-model="modelValue" type="checkbox" :disabled="disabled" />
  </label>
</template>

<script setup lang="ts">
// 滑动开关（iOS 风格 pill + 圆点）：语义为"启用/停用"。
// 为什么不用 checkbox 形态：与「固定」这类勾选语义在视觉上抢同一种控件，用户无法区分
// "勾上=固定"和"勾上=启用"是两种不同维度的状态；开关形态让停用类操作一眼可辨。
// 为什么 input 视觉隔离（opacity:0）而轨道/圆点画在 label 伪元素上：酒馆全局 style.css 对
// 所有 input[type=checkbox] 叠了一整套外观（outline 外圈、深色 background、translateY 偏移、
// ::before 画勾），在其上重绘必须逐属性对抗——漏掉的属性全部泄漏（首版因此开关上叠出了
// 酒馆的深色勾与外圈）。label 上酒馆没有任何全局样式，画在那里一劳永逸。
// input 仍保留在 DOM（点击经 label 原生联动、键盘可达性、v-model 全部照常）。
defineProps<{
  title?: string;
  disabled?: boolean;
}>();

const modelValue = defineModel<boolean>({ required: true });
</script>

<style scoped>
.choice-switch {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}

/* input 只承担交互不承担外观：absolute + opacity:0 与酒馆全局 checkbox 样式彻底隔离 */
.choice-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  transform: none;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
}

/* 轨道 */
.choice-switch::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
}

.choice-switch--on::before {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
}

/* 键盘焦点环（input 视觉隐藏后由 label 的 focus-within 代为呈现） */
.choice-switch:focus-within::before {
  box-shadow: 0 0 0 2px var(--choice-primary-light);
}

/* 圆点 */
.choice-switch::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 3px;
  width: 12px;
  height: 12px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--choice-text-muted);
  transition:
    transform var(--choice-transition),
    background var(--choice-transition);
}

.choice-switch--on::after {
  transform: translateY(-50%) translateX(10px);
  background: var(--choice-text-on-primary);
}

.choice-switch input:disabled {
  cursor: not-allowed;
}

.choice-switch:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
