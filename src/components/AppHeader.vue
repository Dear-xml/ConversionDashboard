<script setup lang="ts">
import type { AppMeta } from '../utils/appMeta'

defineProps<{ title?: string; appMeta?: AppMeta | null }>()
</script>

<template>
  <header class="topbar">
    <strong class="topbar-title">
      {{ title ?? '迁移工作台' }}
      <span
        v-if="appMeta?.projectName"
        class="project-name"
        :title="appMeta.projectPath ?? appMeta.projectName"
      >· {{ appMeta.projectName }}</span>
    </strong>
    <slot />
  </header>
</template>

<style scoped>
.topbar {
  height: 73px;
  background: #ffffffeb;
  border-bottom: 1px solid var(--line);
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.topbar-title {
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.project-name {
  font-weight: 500;
  color: var(--muted);
}
@media (max-width: 700px) {
  .topbar {
    padding: 0 18px;
    height: auto;
    min-height: 56px;
    flex-wrap: wrap;
  }
}
</style>
