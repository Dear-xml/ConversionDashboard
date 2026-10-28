export const UNKNOWN: string = 'unknown'

/**
 * .migration 数据契约相对路径（统一收纳）。
 * 页面订阅与展示文案一律从此取值，路径调整只改这里。
 */
export const DATA_FILES = {
  /** 迁移进度（总览阶段条） */
  progress: 'progress.json',
  /** 页面批次报告（Spec 执行） */
  batchReport: 'page-specs/batch_report.json',
  /** 功能清单分析产物 */
  inventory: 'feature-analysis/inventory.json',
  /** 会话耗时与 token 聚合（服务端虚拟文件） */
  sessions: '.harmonybot/_summary.json',
} as const
