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

/** 自动探测会话目录：数据目录自身、工程根、工程父级下的 .harmonybot */
function detectSessionDir(root) {
  for (const cand of [
    path.join(root, '.harmonybot'),
    path.join(root, '..', '.harmonybot'),
    path.join(root, '..', '..', '.harmonybot'),
  ]) {
    try {
      if (fs.statSync(cand).isDirectory()) return path.resolve(cand)
    } catch {
      // 不存在，继续探测
    }
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
            out[path.relative(root, abs).split(path.sep).join('/')] = {
              mtimeMs: stat.mtimeMs,
              size: stat.size,
            }
          } catch {
            // 文件在扫描间隙被删除，跳过
          }
        }
      }
    }
    walk(root)
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

      // 写接口：POST /api/data/file?p=<可写文件>，body { expectedMtime, updates: [{ capability_key, fields }] }
      if (req.method === 'POST' || req.method === 'PUT') {
        const allowedFields = writable[p]
        if (!allowedFields) {
          res.statusCode = 403
          res.end('forbidden')
          return true
        }
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
          const { expectedMtime, updates } = payload
          if (!Array.isArray(updates)) {
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
          let updated = 0
          for (const u of updates) {
            const i = index.get(u?.key)
            if (i === undefined || !u?.fields || typeof u.fields !== 'object') continue
            for (const [k, v] of Object.entries(u.fields)) {
              if (allowedFields.includes(k)) {
                data.features[i][k] = v
                updated++
              }
            }
          }
          // 原子写：临时文件 + rename
          const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`
          try {
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
            fs.renameSync(tmp, abs)
          } catch {
            res.statusCode = 500
            res.end('write error')
            return
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
        const data = fs.readFileSync(abs)
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
   * 监听数据目录（含会话目录）内白名单文件变化，debounce 300ms 后回调变化的相对路径列表。
   * 会话目录变化统一映射为 .harmonybot/_summary.json。
   * 平台不支持 recursive watch 时返回 null（调用方退化为轮询）。
   */
  const watch = (onChange) => {
    const changed = new Set()
    let timer = null
    const watchers = []
    const dirs = sessionDir ? [root, sessionDir] : [root]

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const files = Array.from(changed)
        changed.clear()
        timer = null
        if (files.length) onChange(files)
      }, 300)
    }

    try {
      for (const dir of dirs) {
        const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const abs = path.isAbsolute(filename) ? filename : path.join(dir, filename)
          if (abs !== dir && !abs.startsWith(dir + path.sep)) return
          if (dir === sessionDir) {
            // 会话目录：任何 ses_*.json 变化都触发聚合文件更新
            if (!/^ses_.*\.json$/.test(path.basename(abs))) return
            changed.add(SESSIONS_KEY)
          } else {
            const rel = path.relative(root, abs).split(path.sep).join('/')
            if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) return
            changed.add(rel)
          }
          flush()
        })
        watcher.on('close', () => {
          if (timer) clearTimeout(timer)
        })
        watchers.push(watcher)
      }
    } catch {
      for (const w of watchers) w.close()
      return null
    }
    return {
      close() {
        for (const w of watchers) w.close()
      },
    }
  }

  return { root, sessionDir, listFiles, handle, watch }
}
