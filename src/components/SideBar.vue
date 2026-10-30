<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { routes } from '../router'
import { DATA_FILES } from '../constants/common'

defineProps<{ collapsed: boolean }>()
defineEmits<{ toggle: [] }>()

const route = useRoute()

const tabs = routes
  .filter((r) => r.meta.tab)
  .map((r) => {
    const meta = r.meta
    return { name: meta.tab, path: r.path, label: meta.title, icon: meta.icon }
  })
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <button type="button" class="collapse-btn" :title="collapsed ? '展开菜单' : '收起菜单'" @click="$emit('toggle')">
      <span class="collapse-icon">{{ collapsed ? '»' : '«' }}</span>
    </button>

    <div class="brand" :title="collapsed ? 'd2h workbench' : undefined">
      <span class="brand-logo"><b>d2h</b></span>
      <span class="brand-text">workbench</span>
      <small class="brand-sub">SPEC PLAN / DELIVERY</small>
    </div>

    <nav class="tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.path"
        class="tab"
        :class="{ active: route.meta.tab === tab.name }"
        :title="collapsed ? tab.label : undefined"
      >
        <span class="icon">{{ tab.icon }}</span>
        <span class="label">{{ tab.label }}</span>
      </RouterLink>
    </nav>

    <div class="side-note">
      <strong>统一派生视图</strong>
      <br />进度真源：{{ DATA_FILES.progress }}
      <br />功能真源：{{ DATA_FILES.inventory }}
      <br />批次真源：{{ DATA_FILES.batchReport }}
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
  padding: 18px 12px 16px;
  display: flex;
  flex-direction: column;
  z-index: 2;
  transition: width 0.2s ease;
  overflow: hidden;
}

/* 收缩态：仅图标 */
.sidebar.collapsed {
  width: 56px;
}

.collapse-btn {
  align-self: flex-end;
  border: 0;
  background: none;
  color: #8191a8;
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1;
}

.collapse-btn:hover {
  background: #f0f5ff;
  color: var(--blue);
}

.collapse-icon {
  font-size: 30px;
}

.brand {
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -1px;
  padding: 8px 10px 0;
  white-space: nowrap;
}

.brand b {
  color: var(--blue);
}

.brand-text,
.brand-sub {
  display: inline-block;
}

.brand small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
  letter-spacing: 1.6px;
  margin: 2px 0 24px;
}

/* 收缩态品牌：只留 d2h 标识 */
.sidebar.collapsed .brand {
  padding: 8px 0 0;
  text-align: center;
  font-size: 15px;
}

.sidebar.collapsed .brand-text,
.sidebar.collapsed .brand-sub {
  display: none;
}

.tabs {
  display: grid;
  gap: 6px;
  margin-top: 6px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  background: none;
  padding: 11px 12px;
  text-decoration: none;
  color: inherit;
  border-radius: 7px;
  white-space: nowrap;
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
  width: 24px;
  flex-shrink: 0;
  text-align: center;
  color: #8191a8;
  font-size: 17px;
  line-height: 1;
}

.tab.active .icon {
  color: #3766dc;
}

/* 收缩态 tab：仅图标居中 */
.sidebar.collapsed .tab {
  justify-content: center;
  padding: 11px 0;
}

.sidebar.collapsed .tab .icon {
  width: auto;
  font-size: 19px;
}

.sidebar.collapsed .tab .label {
  display: none;
}

.side-note {
  margin-top: auto;
  font-size: 12px;
  color: var(--muted);
  padding: 12px 6px;
}

.sidebar.collapsed .side-note {
  display: none;
}
</style>
