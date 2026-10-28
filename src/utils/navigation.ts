import router from '../router'

export type TabName = 'overview' | 'features' | 'tasks'

/**
 * 统一跳转到主导航 tab，供各页面「执行详情 / 全部 →」类按钮调用。
 * 当前存在目标页的仅 features（功能清单）与 tasks（Spec 执行）。
 */
export function jumpToDetail(tab: TabName): void {
  void router.push({ name: tab })
}
