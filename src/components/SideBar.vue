<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { routes } from '../router'

const route = useRoute()

const tabs = routes.map((r) => {
  const meta = r.meta
  return { name: meta.tab, path: r.path, label: meta.title, icon: meta.icon }
})
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <b>d2h</b> workbench
      <small>SPEC PLAN / DELIVERY</small>
    </div>
    <nav class="tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.path"
        class="tab"
        :class="{ active: route.meta.tab === tab.name }"
      >
        <span class="icon">{{ tab.icon }}</span>
        {{ tab.label }}
      </RouterLink>
    </nav>
    <div class="side-note">
      <strong>统一派生视图</strong>
      <br />执行真源：execution.json
      <br />范围真源：features.json
      <br />计划真源：pages.json
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  width: 214px;
  inset: 0 auto 0 0;
  background: #fff;
  border-right: 1px solid var(--line);
  padding: 25px 16px;
  display: flex;
  flex-direction: column;
  z-index: 2;
}
.brand {
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -1px;
  padding: 0 12px;
}
.brand b {
  color: var(--blue);
}
.brand small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
  letter-spacing: 1.6px;
  margin: 0 0 32px;
}
.tabs {
  display: grid;
  gap: 6px;
}
.tab {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  background: none;
  padding: 11px 14px;
  text-decoration: none;
  color: inherit;
  border-radius: 7px;
}
.tab:hover {
  background: #f0f5ff;
}
.tab.active {
  background: #eaf0ff;
  color: #2d59c2;
  font-weight: 600;
  box-shadow: inset 3px 0 #3766dc;
}
.tab .icon {
  display: inline-block;
  width: 28px;
  color: #8191a8;
}
.tab.active .icon {
  color: #3766dc;
}
.side-note {
  margin-top: auto;
  font-size: 12px;
  color: var(--muted);
  padding: 12px;
}
.side-note strong {
  color: #41536e;
}
</style>
