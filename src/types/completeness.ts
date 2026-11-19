// 对应 .migration/feature-analysis/completeness.json 与 feature-gap.json
// （d2h-feature-completeness 锚定核验产物）

export type CompletenessStatus =
  | 'implemented'
  | 'partial'
  | 'mock'
  | 'unreachable'
  | 'absent'
  | 'uncertain'

export interface CompletenessFeature {
  key: string
  path: string[]
  capability_key: string | null
  status: CompletenessStatus
  confidence: string
  evidence: string[]
  matched_files: string[]
  notes?: string
}

export interface CompletenessSummary {
  total: number
  implemented: number
  partial: number
  mock: number
  unreachable: number
  absent: number
  uncertain: number
}

export interface CompletenessSnapshot {
  schema_version: string
  title: string
  language: string
  generated_by: string
  generated_at: string
  inputs: {
    inventory: { path: string; sha256: string }
    harmony: { path: string; revision: string }
  }
  features: CompletenessFeature[]
  summary: CompletenessSummary
  notes: string[]
}

export interface FeatureGapItem {
  key: string
  path: string[]
  capability_key: string | null
  status: CompletenessStatus
}

export interface FeatureGap {
  schema_version: string
  title: string
  generated_at: string
  inputs: Record<string, unknown>
  summary: {
    total: number
    gap: number
    gap_by_status: Record<string, number>
    complete: number
    out_of_scope: number
    unverified: number
  }
  gap: FeatureGapItem[]
  unverified: string[]
  notes: string[]
}
