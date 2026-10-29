export type Tone = 'muted' | 'blue' | 'green' | 'orange' | 'red'

export const CHECK_STATUS_TONE: Record<string, Tone> = {
  passed: 'green',
  skipped: 'muted',
  not_applicable: 'muted',
  failed: 'red',
}
