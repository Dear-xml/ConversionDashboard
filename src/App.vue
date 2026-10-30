<script setup lang="ts">
import { RouterView } from 'vue-router'
import SideBar from './components/SideBar.vue'
import AppHeader from './components/AppHeader.vue'
</script>

<template>
  <SideBar />
  <div class="shell">
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
}
.content {
  max-width: 1550px;
  margin: auto;
  padding: 26px 32px 48px;
}
@media (max-width: 700px) {
  .shell {
    margin-left: 0;
  }
  .content {
    padding: 14px 14px 32px;
  }
}
</style>
