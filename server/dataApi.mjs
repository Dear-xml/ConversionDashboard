import fs from 'node:fs'
import path from 'node:path'

const ALLOWED_EXT = new Set(['.json', '.jsonl', '.md'])

const MIME = {
  '.jsonl': 'application/x-ndjson',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
}

/** 会话聚合虚拟文件（前端固定订阅路径） */
const SESSIONS_KEY = '.harmonybot/_summary.json'
const PROGRESS_KEY = 'progress.json'
const BATCH_REPORT_KEY = 'page-specs/batch_report.json'
const LIVE_PROGRESS_KEYS = [PROGRESS_KEY, BATCH_REPORT_KEY]

function fileStamp(stat) {
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    revision: `${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}`,
  }
}

function timestamp(value) {
  return typeof value === 'string' ? Date.parse(value) || 0 : 0
}

function projectProgress(body, readReport) {
  try {
    const progress = JSON.parse(body)
    const stage = progress?.stages?.find(stage => stage.id === 'code-conversion')
    if (stage?.status !== 'pending' || !progress.summary) return body
    const report = readReport()
    if (!Array.isArray(report?.tasks)) return body

    let selected
    if (report.planning != null) {
      if (report.planning.phase !== 'bound' || !Array.isArray(report.planning.waves)) return body
      selected = new Set(report.planning.waves.flatMap(wave => wave.task_ids ?? []))
    }
    const statuses = new Set(['in_progress', 'implemented', 'completed', 'blocked', 'failed'])
    const resetTime = stage.lastUpdatedAt === progress.createdAt ? 0 : timestamp(stage.lastUpdatedAt)
    let started = false
    let firstStart = Infinity
    let lastActivity = 0
    for (const task of report.tasks) {
      if (!statuses.has(task?.development) || (selected && !selected.has(task.task_id))) continue
      const start = timestamp(task.started_at)
      const activity = Math.max(start, timestamp(task.updated_at), timestamp(task.ended_at))
      if (resetTime && activity <= resetTime) continue
      started = true
      if (start) firstStart = Math.min(firstStart, start)
      lastActivity = Math.max(lastActivity, activity)
    }
    if (!started) return body

    stage.status = 'in_progress'
    stage.startedAt ??= Number.isFinite(firstStart) ? new Date(firstStart).toISOString() : null
    if (lastActivity > timestamp(stage.lastUpdatedAt)) stage.lastUpdatedAt = new Date(lastActivity).toISOString()
    if (lastActivity > timestamp(progress.updatedAt)) progress.updatedAt = new Date(lastActivity).toISOString()
    progress.summary.pending--
    progress.summary.inProgress++
    progress.summary.currentStage = progress.stages.find(stage => ['in_progress', 'blocked'].includes(stage.status)).id
    return JSON.stringify(progress)
  } catch {
    // 账本缺失、正在写入或旧格式时仍可读取原始阶段文件。
    return body
  }
}

/**
 * 自动探测会话目录：自数据目录向上最多 5 层。
 * 近层（depth ≤ 2，即数据目录/工程根/工作目录层）：查自身 + 直接子目录下的 .harmonybot；
 * 外层（depth ≥ 3，多工程共居层）：仅查自身，避免把兄弟工程的会话误聚合进来。最近命中优先。
 */
function detectSessionDir(root) {
  const tryDir = (dir) => {
    try {
      if (fs.statSync(dir).isDirectory()) return path.resolve(dir)
    } catch {
      // 不存在
    }
    return null
  }
  let cur = root
  for (let depth = 0; depth < 5; depth++) {
    // ① 该层自身
    const self = tryDir(path.join(cur, '.harmonybot'))
    if (self) return self
    // ② 近层才扫直接子目录（字母序取第一个命中）
    if (depth < 3) {
      try {
        const children = fs
          .readdirSync(cur, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name))
        for (const child of children) {
          const hit = tryDir(path.join(cur, child.name, '.harmonybot'))
          if (hit) return hit
        }
      } catch {
        // 目录不可读，继续向上
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) break // 到达文件系统根
    cur = parent
  }
  return null
}

/** 聚合全部会话 ses_*.json：耗时与 token 求和（单文件损坏/写入中则跳过） */
function buildSessionsSummary(sessionDir) {
  let entries
  try {
    entries = fs.readdirSync(sessionDir, { withFileTypes: true })
  } catch {
    return null
  }
  const files = entries.filter((e) => e.isFile() && /^ses_.*\.json$/.test(e.name))
  if (!files.length) return null

  const summary = {
    schema_version: 'dashboard-sessions/v1',
    sessionCount: 0,
    durationMs: 0,
    taskDurationMs: 0,
    latestEndTime: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  let maxMtime = 0
  for (const entry of files) {
    const abs = path.join(sessionDir, entry.name)
    try {
      const stat = fs.statSync(abs)
      const data = JSON.parse(fs.readFileSync(abs, 'utf8'))
      summary.sessionCount += 1
      summary.durationMs += Number.isFinite(data.duration) ? data.duration : 0
      summary.taskDurationMs += Number.isFinite(data.taskDuration) ? data.taskDuration : 0
      if (Number.isFinite(data.endTime) && data.endTime > summary.latestEndTime) {
        summary.latestEndTime = data.endTime
      }
      const t = data.tokens
      if (t && typeof t === 'object') {
        for (const key of Object.keys(summary.tokens)) {
          if (Number.isFinite(t[key])) summary.tokens[key] += t[key]
        }
      }
      if (stat.mtimeMs > maxMtime) maxMtime = stat.mtimeMs
    } catch {
      // 会话文件写入中或损坏，跳过
    }
  }
  if (!summary.sessionCount) return null
  const body = JSON.stringify(summary)
  return { body, stamp: { mtimeMs: maxMtime, size: Buffer.byteLength(body) } }
}

/**
 * 创建数据目录 API：manifest 扫描 + /api/data/* HTTP 处理 + 文件监听。
 * 供 vite 插件（dev/preview）与独立服务器 server/serve.mjs 共用，零依赖。
 * options.sessionDir：undefined=自动探测（数据目录同级/父级 .harmonybot），null=禁用，字符串=显式指定。
 * options.writable：可写文件白名单 → 允许写入的字段列表（默认仅功能清单的 should_develop/release_stage）。
 */
export function createDataApi(dataDir, options = {}) {
  const root = path.resolve(dataDir)
  const sessionDir =
    options.sessionDir === undefined
      ? detectSessionDir(root)
      : options.sessionDir === null
        ? null
        : path.resolve(options.sessionDir)

  const writable =
    options.writable ?? { 'feature-analysis/inventory.json': ['should_develop', 'release_stage'] }

  const sessionsSummary = () => (sessionDir ? buildSessionsSummary(sessionDir) : null)

  const listFiles = () => {
    const out = {}
    const walk = (dir) => {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(abs)
        } else if (entry.isFile() && ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) {
          try {
            const stat = fs.statSync(abs)
            out[path.relative(root, abs).split(path.sep).join('/')] = fileStamp(stat)
          } catch {
            // 文件在扫描间隙被删除，跳过
          }
        }
      }
    }
    walk(root)
    if (out[PROGRESS_KEY]) {
      out[PROGRESS_KEY].revision += `|${out[BATCH_REPORT_KEY]?.revision ?? ''}`
    }
    const sessions = sessionsSummary()
    if (sessions) out[SESSIONS_KEY] = sessions.stamp
    return out
  }

  /**
   * 处理 /api/data/manifest 与 /api/data/file 请求。
   * 命中返回 true；未命中返回 false（调用方继续后续处理）。
   */
  const handle = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/data/manifest') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ root, generatedAt: Date.now(), files: listFiles() }))
      return true
    }
    if (url.pathname === '/api/data/file') {
      const p = url.searchParams.get('p') ?? ''
      if (!p) {
        res.statusCode = 400
        res.end('missing p')
        return true
      }

      // 写接口：POST /api/data/file?p=<可写文件>，body { expectedMtime, updates: [{ key, fields }] }
      if (req.method === 'POST' || req.method === 'PUT') {
        const rule = writable[p]
        if (!rule) {
          res.statusCode = 403
          res.end('forbidden')
          return true
        }
        const allowedFields = rule
        const abs = path.resolve(root, p)
        if (abs !== root && !abs.startsWith(root + path.sep)) {
          res.statusCode = 403
          res.end('forbidden')
          return true
        }
        let body = ''
        let tooLarge = false
        req.on('data', (chunk) => {
          body += chunk
          if (body.length > 5 * 1024 * 1024) {
            tooLarge = true
            req.destroy()
          }
        })
        req.on('end', () => {
          if (tooLarge) {
            res.statusCode = 413
            res.end('too large')
            return
          }
          let payload
          try {
            payload = JSON.parse(body)
          } catch {
            res.statusCode = 400
            res.end('invalid json')
            return
          }
          const { expectedMtime } = payload
          if (!Array.isArray(payload.updates)) {
            res.statusCode = 400
            res.end('updates must be an array')
            return
          }
          let stat
          try {
            stat = fs.statSync(abs)
          } catch {
            res.statusCode = 404
            res.end('not found')
            return
          }
          // 乐观锁：文件已被迁移进程或其他写入方改动 → 409
          if (typeof expectedMtime === 'number' && Math.abs(stat.mtimeMs - expectedMtime) > 1) {
            res.statusCode = 409
            res.end('conflict: file changed')
            return
          }
          let data
          try {
            data = JSON.parse(fs.readFileSync(abs, 'utf8'))
          } catch {
            res.statusCode = 500
            res.end('read error')
            return
          }
          let updated = 0
          if (!Array.isArray(data.features)) {
            res.statusCode = 500
            res.end('not an inventory')
            return
          }
          // 定位 key：capability_key（可选）优先，缺失时用 JSON.stringify(path) 兜底
          const index = new Map()
          data.features.forEach((f, i) => {
            if (f.capability_key !== undefined && f.capability_key !== null) {
              index.set(f.capability_key, i)
            }
            index.set(JSON.stringify(f.path), i)
          })
          for (const u of payload.updates) {
            const i = index.get(u?.key)
            if (i === undefined || !u?.fields || typeof u.fields !== 'object') continue
            for (const [k, v] of Object.entries(u.fields)) {
              if (allowedFields.includes(k)) {
                data.features[i][k] = v
                updated++
              }
            }
          }
          // 原子写：临时文件 + rename；目标带只读属性（如 Windows ReadOnly）时自动去除后重试一次
          const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`
          try {
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
            fs.renameSync(tmp, abs)
          } catch (err) {
            const retryable = err && (err.code === 'EPERM' || err.code === 'EACCES')
            let done = false
            if (retryable) {
              try {
                fs.chmodSync(abs, 0o666)
                fs.renameSync(tmp, abs)
                done = true
              } catch {
                // 去只读后仍失败（被其他进程锁定等），走统一失败路径
              }
            }
            if (!done) {
              try {
                fs.unlinkSync(tmp)
              } catch {
                /* 临时文件清理失败不影响结果 */
              }
              res.statusCode = 500
              res.end('write error')
              return
            }
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({ updated }))
        })
        req.on('error', () => {
          try {
            res.statusCode = 400
            res.end('request error')
          } catch {
            /* ignore */
          }
        })
        return true
      }

      if (p === SESSIONS_KEY) {
        const sessions = sessionsSummary()
        if (!sessions) {
          res.statusCode = 404
          res.end('not found')
          return true
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(sessions.body)
        return true
      }
      if (p.startsWith('.harmonybot/')) {
        res.statusCode = 404
        res.end('not found')
        return true
      }
      const abs = path.resolve(root, p)
      if (
        (abs !== root && !abs.startsWith(root + path.sep)) ||
        !ALLOWED_EXT.has(path.extname(abs).toLowerCase())
      ) {
        res.statusCode = 403
        res.end('forbidden')
        return true
      }
      try {
        let data = fs.readFileSync(abs)
        if (p === PROGRESS_KEY) {
          data = projectProgress(data, () => JSON.parse(fs.readFileSync(path.join(root, BATCH_REPORT_KEY), 'utf8')))
        }
        res.statusCode = 200
        res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        res.end(data)
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          res.statusCode = 404
          res.end('not found')
        } else {
          res.statusCode = 500
          res.end('error')
        }
      }
      return true
    }
    return false
  }

  /**
   * 聚合 150ms 内的文件变化；阶段和任务账本独立轮询，兼容原子替换和 watch 失败。
   * 会话目录变化统一映射为 .harmonybot/_summary.json。
   */
  const watch = (onChange) => {
    const changed = new Set()
    let timer = null
    const watchers = []
    const dirs = sessionDir ? [root, sessionDir] : [root]

    const enqueue = key => {
      changed.add(key)
      if (key === BATCH_REPORT_KEY) changed.add(PROGRESS_KEY)
      if (timer) return
      timer = setTimeout(() => {
        const files = Array.from(changed)
        changed.clear()
        timer = null
        onChange(files)
      }, 150)
    }

    const revision = key => {
      try {
        return fileStamp(fs.statSync(path.join(root, key))).revision
      } catch {
        return null
      }
    }
    const liveRevisions = new Map(LIVE_PROGRESS_KEYS.map(key => [key, revision(key)]))
    const poll = setInterval(() => {
      for (const [key, previous] of liveRevisions) {
        const next = revision(key)
        if (next === previous) continue
        liveRevisions.set(key, next)
        enqueue(key)
      }
    }, 500)

    for (const dir of dirs) {
      try {
        const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const abs = path.isAbsolute(filename) ? filename : path.join(dir, filename)
          if (abs !== dir && !abs.startsWith(dir + path.sep)) return
          if (dir === sessionDir) {
            // 会话目录：任何 ses_*.json 变化都触发聚合文件更新
            if (!/^ses_.*\.json$/.test(path.basename(abs))) return
            enqueue(SESSIONS_KEY)
          } else {
            const rel = path.relative(root, abs).split(path.sep).join('/')
            if (LIVE_PROGRESS_KEYS.includes(rel) || !ALLOWED_EXT.has(path.extname(rel).toLowerCase())) return
            enqueue(rel)
          }
        })
        watcher.on('error', () => watcher.close())
        watchers.push(watcher)
      } catch {
        // 其他文件仍由客户端轮询，阶段和账本仍可走 SSE。
      }
    }
    return {
      close() {
        clearInterval(poll)
        clearTimeout(timer)
        for (const w of watchers) w.close()
      },
    }
  }

  return { root, sessionDir, listFiles, handle, watch }
}
