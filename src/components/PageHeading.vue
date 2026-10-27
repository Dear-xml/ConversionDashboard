<script setup lang="ts">
defineProps<{
  kicker?: string
  title: string
  note?: string
}>()
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="kicker">{{ kicker ?? 'D2H' }}</div>
      <h1>{{ title }}</h1>
      <small v-if="note">{{ note }}</small>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.page-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 22px;
}

.kicker {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: #6d83a9;
  margin-bottom: 5px;
}
</style>
