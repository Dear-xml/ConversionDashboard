// 对应 batch_report.json 的页面批次报告产物
export interface BatchCheck {
  spec_id?: string
  check_id?: string
  description: string
  expected?: string
  risk?: string
  level?: string
  timing?: string
  status: string
  test_ref?: string
  evidence?: unknown[]
}

export interface BatchReport {
  schema_version: string
  source: {
    pages_plan: string
    sha256: string
    legacy_report: string
    legacy_report_sha256: string
  }
  created_at: string
  updated_at: string
  /** 里程碑与波次规划（task 的执行顺序由 planning.waves 的顺序决定；旧产物无此结构时按 order 排序） */
  planning?: {
    schema_version?: string
    revision?: number
    phase?: string
    waves?: Array<{
      wave_id: string
      milestone_id?: string
      goal?: string
      task_ids: string[]
    }>
  }
  summary: {
    total: number
    pending: number
    in_progress: number
    completed: number
    blocked: number
    failed: number
  }
  tasks: Array<{
    order: number
    task_id: string
    page_id: string
    kind: string
    page_score: number
    package: string
    /** 页面标题（上游后续产出；展示优先级：page_title > task_id/page_id） */
    page_title?: string
    page_path: string | string[]
    dependencies: string[]
    enablement: number
    ordinary_reachability: number
    shallowness: number
    spec: string
    development: string
    build: string
    validation: string
    implementation_files: unknown[]
    test_files: unknown[]
    android_evidence: unknown[]
    implementation_commit: string | null
    source_snapshot: string | null
    build_evidence: unknown[]
    test_evidence: unknown[]
    differences: string[]
    started_at: string | null
    ended_at: string | null
    updated_at: string | null
    blockers: string[]
    checks?: BatchCheck[]
    history: Array<{
      timestamp: string | null
      details: string
    }>
  }>
  regression: {
    status: string
    hap: string | null
    device: string | null
    evidence: unknown[]
    behavior_review: string | null
    unresolved: unknown[]
    updated_at: string | null
    history: unknown[]
  }
}
