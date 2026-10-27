import type { StageStatus } from '../types/progress'

export type StatusTone = 'muted' | 'blue' | 'green' | 'orange' | 'red'

/**
 * 迁移阶段状态 → 展示文案与色调。
 * 页面/组件通过 STATUS_MAP[status].label 取值，不自行散落中文映射。
 */
export const STATUS_MAP: Record<StageStatus, { label: string; tone: StatusTone }> = {
  pending: { label: '待执行', tone: 'muted' },
  in_progress: { label: '进行中', tone: 'blue' },
  blocked: { label: '已阻塞', tone: 'red' },
  completed: { label: '已完成', tone: 'green' },
}
