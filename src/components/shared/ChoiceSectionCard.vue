<template>
  <section class="choice-section-card" :class="[`tone-${tone}`, { 'is-open': open }]" v-bind="$attrs">
    <header class="choice-section-card-head">
      <button
        class="choice-section-card-toggle"
        type="button"
        :aria-expanded="open"
        @click="open = !open"
      >
        <i class="fa-solid fa-chevron-right choice-section-card-chevron"></i>
        <i v-if="icon" class="choice-section-card-icon" :class="icon"></i>
        <span class="choice-section-card-title">{{ title }}</span>
      </button>
      <div class="choice-section-card-extra" @click.stop>
        <slot name="extra" />
      </div>
    </header>
    <!-- 内容体：v-show 瞬时显示/隐藏（折叠时 display:none、内容仍挂载、零延迟裁剪）。
         不用 grid-template-rows 高度动画——用户反馈展开内容要过一会儿才出来，瞬时显示更跟手 -->
    <div v-show="open" class="choice-section-card-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
// 设置页卡片式可折叠分组（UI 去杂乱）：标题行 + chevron + 右侧常显插槽 + 内容 slot。
// 在现有 ChoiceDisclosure 基础上升级为整块带边框卡片：
// 平铺控件收进有边框、可折叠、标题清晰的分组，密集区默认折叠，打开面板先见分组骨架。
//
// 为什么状态只放组件内 ref 而不持久化：折叠只是布局层面的收纳，收起/展开无业务含义；
// 持久化要加 schema 字段与迁移成本，且切子区卸载即重置（与统计页折叠分区行为一致）。
//
// 为什么 inheritAttrs:false + $attrs 落容器：调用方可带 data-tour 锚点（如 gen-dice），
// 锚点必须留在最外层容器便于引导定位——落到内部 button 会让锚点语义失真。
//
// 为什么展开用 v-show 瞬时显示而非高度动画：此前用 grid-template-rows 0fr<->1fr
// 做高度过渡，用户反馈展开时内容被裁剪、要过一会儿才完全露出（生成页大卡最明显）。
// 改 v-show：收起=display:none、展开=立即出现，内容始终挂载，零延迟、无裁剪。
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** 标题文案 */
    title: string;
    /** 初始展开态（不持久化，切子区卸载即重置；密集分组默认 false） */
    defaultOpen?: boolean;
    /** 可选 FA 图标类名（如 'fa-solid fa-dice'），省略时纯文字标题 */
    icon?: string;
    /** 标题图标语义色：primary（默认，主色）/ danger（危险操作红色） */
    tone?: 'primary' | 'danger';
  }>(),
  { defaultOpen: false, icon: undefined, tone: 'primary' },
);

const open = ref(props.defaultOpen);
</script>

<style scoped>
.choice-section-card {
  display: flex;
  flex-direction: column;
  background: var(--choice-bg-card);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-md);
  /* 轻微投影：让卡片从面板背景上「浮起」，不再是素盒子的平贴感。
     又因带投影，内部不再加投影，避免叠影 */
  box-shadow: var(--choice-shadow-sm);
  overflow: hidden;
}

.choice-section-card-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

/* 整条标题行可点（右侧 extra 之外的区域全部命中 toggle） */
.choice-section-card-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex: 1;
  min-width: 0;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: transparent;
  border: none;
  color: var(--choice-text);
  font-size: var(--choice-text-sm);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

/* hover：整行（含右侧 extra 区）统一高亮，避免只给 toggle 上底色导致右侧留出接缝 */
.choice-section-card:hover .choice-section-card-head {
  background: var(--choice-bg-hover);
}

.choice-section-card:hover .choice-section-card-title,
.choice-section-card:hover .choice-section-card-chevron {
  color: var(--choice-primary);
}

/* 标题文字：超长省略，不撑破卡片 */
.choice-section-card-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* chevron：收起朝右、展开旋转 90° 朝下；展开态转主色，明确「可点」 */
.choice-section-card-chevron {
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  transition:
    transform var(--choice-transition),
    color var(--choice-transition);
}

.choice-section-card-toggle[aria-expanded='true'] .choice-section-card-chevron {
  transform: rotate(90deg);
  color: var(--choice-primary);
}

/* 标题左侧图标：恒用语义色点亮（primary 默认 / danger 红），而非灰字——
   图标一色即「这是分组」的语义信号，让卡片不像无标题的素盒子 */
.choice-section-card-icon {
  flex-shrink: 0;
  font-size: var(--choice-text-sm);
  color: var(--choice-primary);
}

.choice-section-card.tone-danger .choice-section-card-icon {
  color: var(--choice-color-error);
}

.choice-section-card-toggle:hover .choice-section-card-icon {
  color: var(--choice-primary);
}

.choice-section-card.tone-danger .choice-section-card-toggle:hover .choice-section-card-icon {
  color: var(--choice-color-error);
}

/* 右侧常显插槽（外置开关等）：点击被 @click.stop 截断，不触发 toggle */
.choice-section-card-extra {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-shrink: 0;
  padding-right: var(--choice-space-4);
}

/* 内容体：v-show 控制显示/隐藏；顶部留分割线与标题行分隔 */
.choice-section-card-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: var(--choice-space-3) var(--choice-space-4);
  padding-bottom: var(--choice-space-4);
  border-top: 1px solid var(--choice-border);
}

@media (prefers-reduced-motion: reduce) {
  .choice-section-card-chevron {
    transition: none;
  }
}
</style>
