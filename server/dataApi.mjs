import fs from 'node:fs'
import path from 'node:path'

const ALLOWED_EXT = new Set(['.json', '.jsonl'])

const MIME = {
  '.jsonl': 'application/x-ndjson',
  '.json': 'application/json',
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
 */
export function createDataApi(dataDir, options = {}) {
  const root = path.resolve(dataDir)
  const sessionDir =
    options.sessionDir === undefined
      ? detectSessionDir(root)
      : options.sessionDir === null
        ? null
        : path.resolve(options.sessionDir)

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
