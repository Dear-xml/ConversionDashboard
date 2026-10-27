// 进度总览

export type StageStatus = 'pending' | 'in_progress' | 'blocked' | 'completed'

export interface RawProgress {
  schemaVersion: string
  createdAt: string
  updatedAt: string
  summary: {
    total: number
    pending: number
    inProgress: number
    blocked: number
    completed: number
    currentStage: string
  }
  stages: Array<{
    order: number
    id: string
    name: string
    status: StageStatus
    startedAt: string | null
    endedAt: string | null
    completed: boolean
    lastUpdatedAt: string
    details: unknown
    blockers: unknown[]
  }>
}
