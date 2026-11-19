<script setup lang="ts">
import type { AppMeta } from '../utils/appMeta'
import { SNAPSHOT } from '../utils/JsonOperateUtils'
import { formatTime } from '../utils/datetime'

defineProps<{ title?: string; appMeta?: AppMeta | null }>()

const snapshotAt = SNAPSHOT ? formatTime(SNAPSHOT.generatedAt) : null
const snapshotRoot = SNAPSHOT?.root ?? ''
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
    <span
      v-if="snapshotAt"
      class="snapshot-badge"
      :title="`静态快照（离线只读）· 生成于 ${snapshotAt} · 数据目录 ${snapshotRoot}`"
    >静态快照 · {{ snapshotAt }}</span>
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
.snapshot-badge {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 500;
  color: #815e0d;
  background: #fff1d3;
  border: 1px solid #ecd9a8;
  border-radius: 20px;
  padding: 3px 10px;
  white-space: nowrap;
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
