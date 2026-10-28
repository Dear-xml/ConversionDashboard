// 对应 batch_report.json 的页面批次报告产物
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
    page_path: string
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
    differences: unknown[]
    started_at: string | null
    ended_at: string | null
    updated_at: string | null
    blockers: unknown[]
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
