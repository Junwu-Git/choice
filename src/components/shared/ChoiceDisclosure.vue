<template>
  <div class="choice-disclosure" v-bind="$attrs">
    <div class="choice-disclosure-head">
      <button class="choice-disclosure-toggle" type="button" :aria-expanded="open" @click="open = !open">
        <i class="fa-solid fa-chevron-right choice-disclosure-chevron"></i>
        <i v-if="icon" class="choice-disclosure-icon" :class="icon"></i>
        <span>{{ title }}</span>
      </button>
      <div class="choice-disclosure-extra" @click.stop>
        <slot name="extra" />
      </div>
    </div>
    <div v-if="open" class="choice-disclosure-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
// 折叠区容器（设置页开关密集处的"高级披露器"）：标题行 + chevron + 右侧常显插槽 + 内容 slot。
// 为什么状态只放组件内 ref 而不持久化：折叠只是布局层面的收纳，收起/展开无业务含义；
// 持久化要加 schema 字段与迁移成本，且切子区卸载即重置（与统计页折叠分区行为一致）。
// 为什么 inheritAttrs:false + $attrs 落容器：调用方可带 data-tour 锚点（如 gen-dice），
// 锚点必须留在最外层容器便于引导定位——落到内部 button 会让锚点语义失真。
// 为什么不用 Transition：与统计页折叠分区一致，纯 v-if 无动画，避免切页时抖动。
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 标题文案 */
    title: string;
    /** 初始展开态（不持久化，切子区卸载即重置） */
    defaultOpen?: boolean;
    /** 可选 FA 图标类名（如 'fa-solid fa-dice'），省略时纯文字标题 */
    icon?: string;
  }>(),
  { defaultOpen: false, icon: undefined },
);

const open = ref(props.defaultOpen);
</script>

<style scoped>
.choice-disclosure {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-disclosure-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-disclosure-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  /* 占满余宽：整条标题都可点，右侧 extra 之外的区域全部命中 toggle */
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--choice-text);
  font-size: var(--choice-text-sm);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: color var(--choice-transition);
}

.choice-disclosure-toggle:hover {
  color: var(--choice-primary);
}

.choice-disclosure-toggle > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* chevron：收起朝右、展开旋转 90° 朝下；旋转加过渡但不做展开动画 */
.choice-disclosure-chevron {
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  transition: transform var(--choice-transition);
}

.choice-disclosure-toggle[aria-expanded='true'] .choice-disclosure-chevron {
  transform: rotate(90deg);
}

/* 标题左侧可选图标：与标题同视觉层级，比 chevron 稍大 */
.choice-disclosure-icon {
  flex-shrink: 0;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
}

.choice-disclosure-toggle:hover .choice-disclosure-icon {
  color: var(--choice-text-secondary);
}

/* 右侧常显插槽（外置开关等）：点击被 @click.stop 截断，不触发 toggle */
.choice-disclosure-extra {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-shrink: 0;
}

/* 展开内容：浅底 + 边框，与标题行形成明显的从属关系；内部纵向堆叠交给默认 slot 内容 */
.choice-disclosure-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: var(--choice-space-3);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
}

@media (prefers-reduced-motion: reduce) {
  .choice-disclosure-chevron {
    transition: none;
  }
}
</style>
