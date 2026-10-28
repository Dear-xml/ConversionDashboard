export type Tone = 'muted' | 'blue' | 'green' | 'orange' | 'red'

export const DEVELOPMENT_TONE: Record<string, Tone> = {
  pending: 'muted',
  in_progress: 'blue',
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
