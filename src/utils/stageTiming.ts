import type { RawProgress } from '../types/progress'

type StageTiming = Pick<RawProgress['stages'][number], 'status' | 'startedAt' | 'endedAt'>

export function formatStageTiming(
  stage: StageTiming,
  formatDate: (value: string) => string,
  formatDuration: (milliseconds: number) => string,
): { start: string; end: string } {
  const { startedAt, endedAt, status } = stage
  const started = startedAt === null ? NaN : Date.parse(startedAt)
  const ended = endedAt === null ? NaN : Date.parse(endedAt)
  const hasEnd = endedAt !== null && Number.isFinite(ended)
  const elapsed = ended - started

  // CLI 补写旧阶段完成状态时，可能把开始和完成记录为同一时刻。
  const hasStart = startedAt !== null && Number.isFinite(started) && (!hasEnd || elapsed > 0)
  const start = hasStart
    ? `开始 ${formatDate(startedAt)}`
    : status === 'pending' ? '未开始' : '开始时间未记录'

  if (!hasEnd) return { start, end: '' }
  const finished = `完成 ${formatDate(endedAt)}`
  if (!hasStart) return { start, end: `${finished} · 用时未记录` }
  const duration = elapsed < 1000 ? '用时不足 1 秒' : `用时 ${formatDuration(elapsed)}`
  return { start, end: `${finished} · ${duration}` }
}
