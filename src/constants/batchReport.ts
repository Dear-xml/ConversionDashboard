export type Tone = 'muted' | 'blue' | 'green' | 'orange' | 'red'

export const DEVELOPMENT_TONE: Record<string, Tone> = {
  pending: 'muted',
  in_progress: 'blue',
  implemented: 'green',
  completed: 'green',
  blocked: 'red',
  failed: 'red',
}

export const RUN_TONE: Record<string, Tone> = {
  not_run: 'muted',
  running: 'blue',
  passed: 'green',
  failed: 'red',
}

/** page_path 归一化：数组 join(' / ')，字符串原样返回 */
export function pagePathText(p: string | string[] | undefined): string {
  if (Array.isArray(p)) return p.join(' / ')
  return p ?? ''
}
