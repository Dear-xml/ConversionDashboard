export interface FileStamp {
  mtimeMs: number
  size: number
  revision?: string
}

export interface DataManifest {
  root: string
  generatedAt: number
  files: Record<string, FileStamp>
}

export interface ChangeMeta {
  relPath: string
  fetchedAt: number
  /** 文件最后修改时间（来自 manifest stat），供无时间字段的 JSON 兜底展示 */
  mtimeMs?: number
}

/** 普通文件的兜底轮询间隔。 */
export const DEFAULT_POLL_MS = 10_000

const DATA_BASE = '/api/data'
const LIVE_PROGRESS_FILES = new Set(['progress.json', 'page-specs/batch_report.json'])
const PROGRESS_POLL_MS = 2_000
const REQUEST_TIMEOUT_MS = 5_000
let pendingManifest: Promise<DataManifest> | undefined

// ---- 静态快照模式：--export-snapshot 导出的单文件 HTML 注入数据后 file:// 离线可用 ----
export interface SnapshotFile {
  text: string
  mtimeMs: number
  size: number
}

export interface SnapshotPayload {
  generatedAt: string
  root: string
  files: Record<string, SnapshotFile>
}

declare global {
  interface Window {
    __D2H_SNAPSHOT__?: SnapshotPayload | null
  }
}

/** 非空表示运行在导出的静态快照 HTML 中：数据内嵌只读，无 server。 */
export const SNAPSHOT: SnapshotPayload | null =
  typeof window !== 'undefined' && window.__D2H_SNAPSHOT__ ? window.__D2H_SNAPSHOT__ : null

function snapshotText(relPath: string): string {
  const file = SNAPSHOT?.files[relPath]
  if (!file) throw new Error(`数据文件不存在: ${relPath}`)
  return file.text
}

function snapshotBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function loadManifest(): Promise<DataManifest> {
  if (SNAPSHOT) {
    const files: Record<string, FileStamp> = {}
    for (const [rel, file] of Object.entries(SNAPSHOT.files)) {
      files[rel] = { mtimeMs: file.mtimeMs, size: file.size }
    }
    return Promise.resolve({ root: SNAPSHOT.root, generatedAt: Date.parse(SNAPSHOT.generatedAt) || 0, files })
  }
  pendingManifest ??= (async () => {
    const response = await fetch(`${DATA_BASE}/manifest`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`读取 manifest 失败 (HTTP ${response.status})`)
    return (await response.json()) as DataManifest
  })().finally(() => { pendingManifest = undefined })
  return pendingManifest
}

// ---- SSE 实时推送（dist/serve 模式；dev 走 Vite WS，不建 SSE） ----
let sharedSse: EventSource | null = null
const sseSubs = new Set<{ relPath: string; trigger: () => void }>()

function ensureSse(): void {
  if (SNAPSHOT || sharedSse || import.meta.hot || typeof EventSource === 'undefined') return
  sharedSse = new EventSource(`${DATA_BASE}/events`)
  let connected = false
  sharedSse.onopen = (): void => {
    if (connected) {
      for (const sub of sseSubs) sub.trigger()
    }
    connected = true
  }
  sharedSse.onmessage = (ev: MessageEvent<string>): void => {
    try {
      const { files } = JSON.parse(ev.data) as { files?: string[] }
      if (!Array.isArray(files)) return
      for (const sub of sseSubs) {
        if (files.includes(sub.relPath)) sub.trigger()
      }
    } catch {
      // 非 JSON 事件体（如心跳注释），忽略
    }
  }
  // onerror 不处理：EventSource 自动重连；期间由兜底轮询覆盖
}

function isJsonl(relPath: string): boolean {
  return relPath.toLowerCase().endsWith('.jsonl')
}

function parseJsonl<T>(text: string): T[] {
  const out: T[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      // 文件写入一半时的尾行，忽略
    }
  }
  return out
}

/** 读取数据目录中任意文件的原始二进制（no-store）。 */
export async function readFileArrayBuffer(relPath: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (SNAPSHOT) return snapshotBuffer(snapshotText(relPath))
  const url = `${DATA_BASE}/file?p=${encodeURIComponent(relPath)}`
  const res = await fetch(url, { cache: 'no-store', signal })
  if (res.status === 404) throw new Error(`数据文件不存在: ${relPath}`)
  if (!res.ok) throw new Error(`读取失败 (HTTP ${res.status}): ${relPath}`)
  return res.arrayBuffer()
}

/** 读取数据目录中任意文本文件（如 spec.md）。 */
export async function readText(relPath: string, signal?: AbortSignal): Promise<string> {
  return fetchText(relPath, signal)
}

/**
 * 写回数据目录中的 JSON（增量合并，仅服务端可写白名单内的文件与字段）。
 * body: { expectedMtime, updates: [{ key, fields: {…} }] }
 * key 为功能唯一标识：capability_key 优先，缺失用 JSON.stringify(path)。
 * 返回服务端 { updated }；409 冲突时抛「数据已变化」。
 */
export async function writeJson(
  relPath: string,
  body: {
    expectedMtime?: number | null
    updates: Array<{ key: string; fields: Record<string, unknown> }>
  },
  signal?: AbortSignal,
): Promise<{ updated: number }> {
  if (SNAPSHOT) throw new Error('静态快照只读，不可回写')
  const url = `${DATA_BASE}/file?p=${encodeURIComponent(relPath)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    signal,
    body: JSON.stringify(body),
  })
  if (res.status === 409) throw new Error('数据已变化，请刷新后重试')
  if (res.status === 403) throw new Error('该文件不可写')
  if (!res.ok) throw new Error(`写入失败 (HTTP ${res.status})`)
  return res.json()
}

async function fetchText(relPath: string, signal?: AbortSignal): Promise<string> {
  if (SNAPSHOT) return snapshotText(relPath)
  const url = `${DATA_BASE}/file?p=${encodeURIComponent(relPath)}`
  const res = await fetch(url, { cache: 'no-store', signal })
  if (res.status === 404) throw new Error(`数据文件不存在: ${relPath}`)
  if (!res.ok) throw new Error(`读取失败 (HTTP ${res.status}): ${relPath}`)
  return res.text()
}

/**
 * 读取数据目录中的 JSON / JSONL 文件。
 * relPath 为相对于数据根目录的路径，可包含子文件夹，如 'subdir/foo.json'。
 */
export async function readJson<T = unknown>(relPath: string, signal?: AbortSignal): Promise<T> {
  const text = await fetchText(relPath, signal)
  if (isJsonl(relPath)) return parseJsonl<T>(text) as T
  try {
    return JSON.parse(text) as T
  } catch {
    // 文件写入一半时重试一次
    const retried = await fetchText(relPath, signal)
    try {
      return JSON.parse(retried) as T
    } catch {
      throw new Error(`JSON 解析失败: ${relPath}`)
    }
  }
}

/**
 * 列出数据目录中匹配前缀的文件（一次性读取 manifest，不订阅变化）。
 * 用于发现动态命名的产物（如 code-audit/history/ 归档）。
 */
export async function listDataFiles(
  prefix: string,
  signal?: AbortSignal,
): Promise<Array<{ relPath: string; mtimeMs: number; size: number }>> {
  if (SNAPSHOT) {
    return Object.entries(SNAPSHOT.files)
      .filter(([p]) => p.startsWith(prefix))
      .map(([relPath, file]) => ({ relPath, mtimeMs: file.mtimeMs, size: file.size }))
  }
  const res = await fetch(`${DATA_BASE}/manifest`, { cache: 'no-store', signal })
  if (!res.ok) throw new Error(`读取 manifest 失败 (HTTP ${res.status})`)
  const manifest = (await res.json()) as DataManifest
  return Object.entries(manifest.files)
    .filter(([p]) => p.startsWith(prefix))
    .map(([relPath, stamp]) => ({ relPath, mtimeMs: stamp.mtimeMs, size: stamp.size }))
}

/**
 * 监听数据目录中任意文件的变化，变化时回调其原始二进制。
 * dev 走 Vite WS 推送；dist/serve 走 SSE 推送（/api/data/events）；
 * 两者均不可用时按 pollMs 轮询 manifest 对比兜底。
 * 返回取消订阅函数。
 */
export function onFileChange(
  relPath: string,
  callback: (buf: ArrayBuffer, meta: ChangeMeta) => void | Promise<void>,
  options: { pollMs?: number; immediate?: boolean } = {},
): () => void {
  // 静态快照：立即加载一次即止，无轮询/SSE
  if (SNAPSHOT) {
    if (options.immediate !== false) {
      void (async () => {
        const file = SNAPSHOT.files[relPath]
        if (!file) return
        try {
          await callback(snapshotBuffer(file.text), {
            relPath,
            fetchedAt: Date.parse(SNAPSHOT.generatedAt) || Date.now(),
            mtimeMs: file.mtimeMs,
          })
        } catch (err) {
          console.warn(`[JsonOperateUtils] 快照读取 ${relPath} 失败:`, err)
        }
      })()
    }
    return () => {}
  }
  const {
    pollMs = LIVE_PROGRESS_FILES.has(relPath) ? PROGRESS_POLL_MS : DEFAULT_POLL_MS,
    immediate = true,
  } = options
  let disposed = false
  let loading = false
  let refreshAgain = false
  let lastRevision: string | undefined
  let fileRequest: AbortController | undefined

  const check = async (): Promise<void> => {
    if (disposed) return
    if (loading) {
      refreshAgain = true
      return
    }
    loading = true
    try {
      const stamp = (await loadManifest()).files[relPath]
      if (disposed) return
      if (!stamp) {
        lastRevision = undefined
        return
      }
      const revision = stamp.revision ?? `${stamp.mtimeMs}:${stamp.size}`
      if (revision === lastRevision) return

      const request = new AbortController()
      fileRequest = request
      const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS)
      try {
        const buf = await readFileArrayBuffer(relPath, request.signal)
        if (disposed) return
        await callback(buf, { relPath, fetchedAt: Date.now(), mtimeMs: stamp.mtimeMs })
        lastRevision = revision
      } finally {
        clearTimeout(timeout)
        fileRequest = undefined
      }
    } catch (err) {
      if (!disposed) console.warn(`[JsonOperateUtils] 读取 ${relPath} 失败:`, err)
    } finally {
      loading = false
      if (refreshAgain) {
        refreshAgain = false
        void check()
      }
    }
  }

  const hot = import.meta.hot
  const onHot = (payload: { files?: string[] }): void => {
    if (payload?.files?.includes(relPath)) void check()
  }
  hot?.on('dashboard:data-changed', onHot)

  // SSE 订阅注册（dist 模式实时推送；与 dev 的 Vite WS 互斥）
  const sub = { relPath, trigger: () => void check() }
  sseSubs.add(sub)
  ensureSse()

  if (immediate) void check()
  const timer = setInterval(() => void check(), pollMs)

  return () => {
    disposed = true
    clearInterval(timer)
    fileRequest?.abort()
    hot?.off('dashboard:data-changed', onHot)
    sseSubs.delete(sub)
    if (sseSubs.size === 0 && sharedSse) {
      sharedSse.close()
      sharedSse = null
    }
  }
}

/**
 * 监听数据文件中某个 JSON / JSONL 的变化并解析成对象。
 * 返回取消订阅函数。
 */
export function onJsonChange<T = unknown>(
  relPath: string,
  callback: (data: T, meta: ChangeMeta) => void | Promise<void>,
  options: { pollMs?: number; immediate?: boolean } = {},
): () => void {
  return onFileChange(
    relPath,
    async (buf, meta) => {
      const text = new TextDecoder().decode(buf)
      let data: T
      if (isJsonl(relPath)) {
        data = parseJsonl<T>(text) as T
      } else {
        try {
          data = JSON.parse(text) as T
        } catch {
          throw new Error(`JSON 解析失败: ${relPath}`)
        }
      }
      await callback(data, meta)
    },
    options,
  )
}
