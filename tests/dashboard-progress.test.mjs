import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { onJsonChange } from '../src/utils/JsonOperateUtils.ts'

const server = fileURLToPath(new URL('../server/serve.mjs', import.meta.url))
const progressFile = 'progress.json'
const reportFile = 'page-specs/batch_report.json'
const initialTime = '2026-11-17T01:00:00Z'
const taskTime = '2026-11-17T02:00:00.000Z'

test('a task claim updates dashboard stage and task data without rewriting progress.json', { timeout: 8_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'dashboard-progress-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (name, data) => {
    const target = path.join(root, name)
    await writeFile(`${target}.tmp`, JSON.stringify(data))
    await rename(`${target}.tmp`, target)
  }
  const stage = (id, status) => ({ id, status, startedAt: null, lastUpdatedAt: initialTime, blockers: [] })
  const progress = {
    updatedAt: initialTime,
    summary: { total: 3, completed: 1, pending: 2, inProgress: 0, blocked: 0, currentStage: 'code-conversion' },
    stages: [stage('spec-design-generation', 'completed'), stage('code-conversion', 'pending'), stage('testing-delivery', 'pending')],
  }
  const report = {
    tasks: [
      { task_id: 'PAGE-1', development: 'pending' },
      { task_id: 'PAGE-2', development: 'implemented', started_at: taskTime, updated_at: taskTime },
    ],
    planning: { phase: 'bound', waves: [{ task_ids: ['PAGE-1'] }] },
  }
  await mkdir(path.join(root, 'page-specs'))
  await write(progressFile, progress)
  await write(reportFile, report)
  const appDir = path.join(root, 'app')
  await mkdir(appDir)
  await writeFile(path.join(appDir, 'index.html'), '<!doctype html><title>Dashboard fixture</title>')
  const child = spawn(process.execPath, [server, '--dataDir', root, '--dir', appDir, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = once(child, 'exit')
  t.after(async () => { child.kill(); await exited })
  let origin
  for await (const line of createInterface({ input: child.stdout })) {
    origin = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
    if (origin) break
  }
  assert.ok(origin)
  const manifest = () => fetch(`${origin}/api/data/manifest`).then(res => res.json())
  const read = file => fetch(`${origin}/api/data/file?p=${encodeURIComponent(file)}`).then(res => res.json())
  const before = await manifest()
  assert.equal((await read(progressFile)).stages[1].status, 'pending', 'excluded task cannot start the stage')

  const response = await fetch(`${origin}/api/data/events`, { signal: AbortSignal.timeout(3_000) })
  const events = response.body.getReader()
  t.after(() => events.cancel().catch(() => {}))
  Object.assign(report.tasks[0], { development: 'in_progress', started_at: taskTime, updated_at: taskTime })
  await write(reportFile, report)

  const view = await read(progressFile)
  assert.equal(view.stages[1].status, 'in_progress')
  assert.equal(view.stages[1].startedAt, taskTime)
  assert.equal(view.summary.inProgress, 1)
  assert.equal(view.summary.pending, 1)
  assert.equal(view.summary.completed, 1)
  assert.deepEqual(JSON.parse(await readFile(path.join(root, progressFile), 'utf8')), progress)
  assert.notDeepEqual((await manifest()).files[progressFile], before.files[progressFile])
  let data = ''
  while (!data.includes(`"${progressFile}"`)) {
    const { value, done } = await events.read()
    assert.equal(done, false)
    data += Buffer.from(value).toString()
  }
  assert.match(data, /page-specs\/batch_report\.json/)

  report.tasks[0].development = 'implemented'
  await write(reportFile, report)
  assert.equal((await read(progressFile)).stages[1].status, 'in_progress', 'no completion without explicit stage evidence')

  progress.stages[1].lastUpdatedAt = '2026-11-17T03:00:00Z'
  await write(progressFile, progress)
  assert.equal((await read(progressFile)).stages[1].status, 'pending', 'historical tasks cannot override a stage reset')

  progress.stages[1].status = 'blocked'
  await write(progressFile, progress)
  assert.equal((await read(progressFile)).stages[1].status, 'blocked')
})

test('a second event during a failed read retries the same file revision', { timeout: 3_000 }, async t => {
  const originalEventSource = globalThis.EventSource
  let events
  globalThis.EventSource = class {
    constructor() { events = this }
    close() {}
  }
  t.after(() => { globalThis.EventSource = originalEventSource })
  t.mock.method(console, 'warn', () => {})
  const firstRead = Promise.withResolvers()
  const firstResponse = Promise.withResolvers()
  const loaded = Promise.withResolvers()
  let reads = 0
  t.mock.method(globalThis, 'fetch', url => {
    if (url.endsWith('/manifest')) {
      return Response.json({ files: { [progressFile]: { mtimeMs: 123, size: 30, revision: 'first' } } })
    }
    if (++reads === 1) {
      firstRead.resolve()
      return firstResponse.promise
    }
    return Response.json({ status: 'in_progress' })
  })

  const unsubscribe = onJsonChange(progressFile, loaded.resolve, { pollMs: 60_000 })
  t.after(unsubscribe)
  await firstRead.promise
  events.onmessage({ data: JSON.stringify({ files: [progressFile] }) })
  firstResponse.resolve(new Response('{ incomplete JSON'))
  assert.deepEqual(await loaded.promise, { status: 'in_progress' })
  assert.equal(reads, 2)
})
