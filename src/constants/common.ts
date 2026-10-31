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
  /** 工程与环境预检报告 */
  preflight: 'preflight-report.json',
  /** 架构分析与设计规划（三套结构方案与选型） */
  architecturePlan: 'architecture-plan/architecture-plan.json',
} as const

/** 功能清单「是否实现/是否纳入开发」字段名（对应页面勾选，上游 schema 1.2 已定名） */
export const FEATURE_IMPLEMENTED_FIELD = 'should_develop'

/** 进入该阶段后功能清单锁定（progress.json 的 stage id） */
export const FEATURE_LOCK_STAGE = 'code-conversion'
