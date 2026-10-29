import router from '../router'

export type TabName = 'overview' | 'features' | 'tasks' | 'analysis' | 'project' | 'review'

/** progress.json 阶段 id → 详情 tab（总览「当前任务 / 执行详情」按阶段跳转） */
export const STAGE_TO_TAB: Record<string, TabName> = {
  'workspace-initialization': 'project',
  'feature-inventory': 'features',
  'android-analysis': 'analysis',
  'harmony-architecture': 'analysis',
  'spec-design-generation': 'tasks',
  'code-conversion': 'tasks',
  'testing-delivery': 'review',
}

/**
 * 统一跳转到主导航 tab，供各页面「执行详情 / 全部 →」类按钮调用。
 */
export function jumpToDetail(tab: TabName): void {
  void router.push({ name: tab })
}

/** 阶段 id → tab；未知阶段默认落到 Spec 执行 */
export function stageToTab(stageId: string | null | undefined): TabName {
  return (stageId && STAGE_TO_TAB[stageId]) || 'tasks'
}
