import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
    /** 主导航 tab 标识；不设则不进入侧栏（如详情页） */
    tab?: string
    icon?: string
  }
}

export const routes = [
  {
    path: '/',
    name: 'overview',
    component: () => import('../pages/Overview.vue'),
    meta: { title: '迁移总览', tab: 'overview', icon: '◫' },
  },
  {
    path: '/features',
    name: 'features',
    component: () => import('../pages/FeaturesList.vue'),
    meta: { title: '功能清单', tab: 'features', icon: '☷' },
  },
  {
    path: '/analysis',
    name: 'analysis',
    component: () => import('../pages/Analysis.vue'),
    meta: { title: '架构分析与设计', tab: 'analysis', icon: '⌕' },
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('../pages/SpecDetail.vue'),
    meta: { title: 'Spec 执行', tab: 'tasks', icon: '☑' },
  },
  {
    path: '/tasks/:taskId',
    name: 'specItemDetail',
    component: () => import('../pages/SpecItemDetail.vue'),
    meta: { title: 'Spec 详情' },
  },
  {
    path: '/project',
    name: 'project',
    component: () => import('../pages/Project.vue'),
    meta: { title: '工程与环境', tab: 'project', icon: '▧' },
  },
  {
    path: '/review',
    name: 'review',
    component: () => import('../pages/Review.vue'),
    meta: { title: '交付 Review', tab: 'review', icon: '◎' },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
