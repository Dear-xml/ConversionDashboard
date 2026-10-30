<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <header class="topbar">
    <strong>{{ title ?? '迁移工作台' }}</strong>
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
.topbar strong {
  font-size: 15px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
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
