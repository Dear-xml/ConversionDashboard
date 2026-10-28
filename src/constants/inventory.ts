export type Tone = 'muted' | 'blue' | 'green' | 'orange' | 'red'

export const RELEASE_STAGE_TONE: Record<string, Tone> = {
  mvp: 'blue',
  core: 'orange',
  full: 'muted',
}

export const CONFIDENCE_TONE: Record<string, Tone> = {
  high: 'green',
  medium: 'orange',
  low: 'red',
}
