import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const ALLOWED_EXT = new Set(['.json', '.jsonl', '.xlsx'])

const MIME: Record<string, string> = {
  '.jsonl': 'application/x-ndjson',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

interface FileStamp {
  mtimeMs: number
  size: number
}

function dashboardData(dataDir: string): Plugin {
  let root = path.resolve(dataDir)
  let watcher: fs.FSWatcher | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const changed = new Set<string>()

  const listFiles = (): Record<string, FileStamp> => {
    const out: Record<string, FileStamp> = {}
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
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
          const stat = fs.statSync(abs)
          out[path.relative(root, abs).split(path.sep).join('/')] = {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          }
        }
      }
    }
    walk(root)
    return out
  }

  return {
    name: 'dashboard-data',
    configureServer(server) {
      server.middlewares.use('/api/data/manifest', (_req, res) => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ root, generatedAt: Date.now(), files: listFiles() }))
      })

      server.middlewares.use('/api/data/file', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const p = url.searchParams.get('p') ?? ''
        if (!p) {
          res.statusCode = 400
          res.end('missing p')
          return
        }
        const abs = path.resolve(root, p)
        if ((abs !== root && !abs.startsWith(root + path.sep)) || !ALLOWED_EXT.has(path.extname(abs).toLowerCase())) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        try {
          const data = fs.readFileSync(abs)
          res.statusCode = 200
          res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          res.end(data)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            res.statusCode = 404
            res.end('not found')
          } else {
            res.statusCode = 500
            res.end('error')
          }
        }
      })

      const schedule = (relPath: string): void => {
        changed.add(relPath)
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = setTimeout(() => {
          const files = Array.from(changed)
          changed.clear()
          flushTimer = null
          server.ws.send({ type: 'custom', event: 'dashboard:data-changed', data: { files } })
        }, 300)
      }

      try {
        watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const abs = path.isAbsolute(filename) ? filename : path.join(root, filename)
          if (abs !== root && !abs.startsWith(root + path.sep)) return
          const rel = path.relative(root, abs).split(path.sep).join('/')
          if (ALLOWED_EXT.has(path.extname(rel).toLowerCase())) schedule(rel)
        })
      } catch (err) {
        console.warn('[dashboard-data] fs.watch 失败，将仅依赖前端轮询:', err)
      }

      server.httpServer?.once('close', () => {
        watcher?.close()
        if (flushTimer) clearTimeout(flushTimer)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dataDir =
    env.DASHBOARD_DATA_DIR ??
    path.resolve(process.cwd(), '..', 'android-to-hmos-migration', 'docs', 'migration-dashboard')
  return {
    plugins: [vue(), dashboardData(dataDir)],
  }
})
