<script setup lang="ts">
import { ref } from 'vue'
import { RouterView } from 'vue-router'
import SideBar from './components/SideBar.vue'
import AppHeader from './components/AppHeader.vue'

const STORAGE_KEY = 'd2h.sidebar.collapsed'

const stored = localStorage.getItem(STORAGE_KEY)
// 已有偏好用偏好；否则窄屏默认收缩
const collapsed = ref(stored !== null ? stored === '1' : window.innerWidth < 900)

const toggleSidebar = (): void => {
  collapsed.value = !collapsed.value
  localStorage.setItem(STORAGE_KEY, collapsed.value ? '1' : '0')
}
</script>

<template>
  <SideBar :collapsed="collapsed" @toggle="toggleSidebar" />
  <div class="shell" :class="{ collapsed }">
    <AppHeader />
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  margin-left: 214px;
  min-width: 0;
  transition: margin-left 0.2s ease;
}

.shell.collapsed {
  margin-left: 56px;
}

.content {
  max-width: 1550px;
  margin: auto;
  padding: 26px 32px 48px;
}

@media (max-width: 700px) {
  .content {
    padding: 14px 14px 32px;
  }
}
</style>
