// 对应 .migration/feature-analysis/inventory.json 的功能清单产物（schema 1.1）
export interface FeatureInventory {
  schema_version: string
  title: string
  language: string
  max_depth: number
  repositories: Array<{
    id: string
    label: string
    path: string
    platform: string
    revision: string
  }>
  features: Array<{
    entry_context: string
    path: string[]
    kind: string
    trigger: string
    effect: string
    conditions: string[]
    release_stage: string
    release_rationale: string
    /** 可选：仅用于跨入口能力去重（上游 inventory-schema）；缺失时前端以 JSON.stringify(path) 兜底作唯一 key */
    capability_key?: string
    notes: string
    /** 是否实现（上游 schema 定名，见 constants/common.ts FEATURE_IMPLEMENTED_FIELD） */
    implemented?: boolean
    implementations: Record<
      string,
      {
        status: string
        confidence: string
        technology_stack: string[]
        technology_evidence: Array<{
          type: string
          path: string
          line_start?: number
          line_end?: number
          symbol?: string
          summary: string
        }>
        external_dependencies: unknown
        android_permissions: unknown
        evidence: unknown[]
        negative_searches: unknown[]
        notes: string
      }
    >
  }>
  open_questions: string[]
  excluded_candidates: Array<{
    name: string
    reason: string
    evidence: string
  }>
}
