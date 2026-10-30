export interface FileStamp {
  mtimeMs: number
  size: number
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

/** 兜底轮询间隔：SSE 推送正常时几乎不触发；SSE 断开/不可用时按此间隔降级刷新 */
export const DEFAULT_POLL_MS = 10_000

const DATA_BASE = '/api/data'

// ---- SSE 实时推送（dist/serve 模式；dev 走 Vite WS，不建 SSE） ----
let sharedSse: EventSource | null = null
const sseSubs = new Set<{ relPath: string; trigger: () => void }>()

function ensureSse(): void {
  if (sharedSse || import.meta.hot || typeof EventSource === 'undefined') return
  sharedSse = new EventSource(`${DATA_BASE}/events`)
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
  const url = `${DATA_BASE}/file?p=${encodeURIComponent(relPath)}`
  const res = await fetch(url, { cache: 'no-store', signal })
  if (res.status === 404) throw new Error(`数据文件不存在: ${relPath}`)
  if (!res.ok) throw new Error(`读取失败 (HTTP ${res.status}): ${relPath}`)
  return res.arrayBuffer()
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
  const { pollMs = DEFAULT_POLL_MS, immediate = true } = options
  let disposed = false
  let ctrl: AbortController | null = null
  let lastStamp: FileStamp | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const load = async (signal?: AbortSignal, mtimeMs?: number): Promise<void> => {
    if (disposed) return
    try {
      const buf = await readFileArrayBuffer(relPath, signal)
      if (disposed) return
      await callback(buf, { relPath, fetchedAt: Date.now(), mtimeMs })
    } catch (err) {
      if (disposed) return
      console.warn(`[JsonOperateUtils] 读取 ${relPath} 失败:`, err)
    }
  }

  const check = async (): Promise<void> => {
    if (disposed) return
    ctrl?.abort()
    ctrl = new AbortController()
    try {
      const res = await fetch(`${DATA_BASE}/manifest`, { cache: 'no-store', signal: ctrl.signal })
      if (!res.ok) return
      const manifest = (await res.json()) as DataManifest
      const stamp = manifest.files[relPath]
      if (!stamp) return
      const changed =
        !lastStamp || lastStamp.mtimeMs !== stamp.mtimeMs || lastStamp.size !== stamp.size
      if (!changed) return
      lastStamp = stamp
      await load(ctrl.signal, stamp.mtimeMs)
    } catch {
      // 断线：保留旧数据，等待下轮
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
  timer = setInterval(() => void check(), pollMs)

  return () => {
    disposed = true
    sseSubs.delete(sub)
    if (timer) clearInterval(timer)
    ctrl?.abort()
    hot?.off('dashboard:data-changed', onHot)
  }
}

/**
 * 监听数据文件中某个 JSON / JSONL 的变化并解析成对象。
 * 返回取消订阅函数。
 */
export function onJsonChange<T = unknown>(
  relPath: string,
  callback: (data: T, meta: ChangeMeta) => void,
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
      callback(data, meta)
    },
    options,
  )
}
