import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStageTiming } from '../src/utils/stageTiming.ts'

const start = '2026-11-17T01:00:00.000Z'
const formatDate = value => value
const formatDuration = milliseconds => `${milliseconds / 1000} 秒`

test('completion without a recorded start keeps the end time and shows an unknown duration', () => {
  for (const id of ['feature-inventory', 'spec-design-generation']) {
    const stage = { id, status: 'completed', startedAt: start, endedAt: start }
    assert.deepEqual(formatStageTiming(stage, formatDate, formatDuration), {
      start: '开始时间未记录',
      end: `完成 ${start} · 用时未记录`,
    })
  }
})

test('recorded timings retain their duration, including work shorter than a second', () => {
  const stage = { status: 'completed', startedAt: start, endedAt: '2026-11-17T01:00:30.000Z' }
  assert.deepEqual(formatStageTiming(stage, formatDate, formatDuration), {
    start: `开始 ${start}`,
    end: `完成 ${stage.endedAt} · 用时 30 秒`,
  })
  const fast = { ...stage, endedAt: '2026-11-17T01:00:00.420Z' }
  assert.equal(formatStageTiming(fast, formatDate, formatDuration).end, `完成 ${fast.endedAt} · 用时不足 1 秒`)
  const running = { ...stage, status: 'in_progress', endedAt: null }
  assert.deepEqual(formatStageTiming(running, formatDate, formatDuration), { start: `开始 ${start}`, end: '' })
})
