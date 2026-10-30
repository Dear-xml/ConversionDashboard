#!/usr/bin/env node
// 独立迁移看板服务器（零依赖，Node >= 18）：
//   node server/serve.mjs --dataDir <project>/.migration [--port 8080] [--host 127.0.0.1] [--dir ../web]
//   node server/serve.mjs --dataDir <project>/.migration --detach [--log-file <path>]
// --detach：自守护启动——父进程 spawn 分离子进程（stdout/stderr 直写日志文件），
//   轮询日志直到子进程就绪后原样打印 stdout 契约并退出；调用方无需 shell 重定向/引号转义。
//   默认日志 %TEMP%/d2h-dashboard-<dataDir哈希8位>.log（每次启动截断重写，跨项目天然隔离）。
// stdout 契约（供 skill 解析）：
//   [dashboard] dataDir=<绝对路径>
//   [dashboard] http://<host>:<实际端口>
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createDataApi } from './dataApi.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function argValue(name) {
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) return argv[i + 1]
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3)
  }
  return undefined
}

const dataDir =
  argValue('dataDir') ??
  argValue('data-dir') ??
  process.env.npm_config_dataDir ??
  process.env.DASHBOARD_DATA_DIR
if (!dataDir) {
  console.error('[dashboard] 缺少 --dataDir 参数（指向迁移工程的 .migration 目录）')
  process.exit(1)
}
if (!fs.existsSync(dataDir)) {
  console.error(`[dashboard] 数据目录不存在: ${dataDir}`)
  process.exit(1)
}

// ---- --detach：spawn 分离子进程并等待就绪，然后父进程退出 ----
if (process.argv.includes('--detach')) {
  const root = path.resolve(dataDir)
  const logFile =
    argValue('log-file') ??
    path.join(os.tmpdir(), `d2h-dashboard-${createHash('sha1').update(root).digest('hex').slice(0, 8)}.log`)
  const errFile = `${logFile}.err`
  const forward = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--detach') continue
    if (a === '--log-file') { i += 1; continue }
    if (a.startsWith('--log-file=')) continue
    forward.push(a)
  }
  // 'w' 截断：每次启动重写日志，杜绝读到上一轮/其他项目的残留内容
  const out = fs.openSync(logFile, 'w')
  const err = fs.openSync(errFile, 'w')
  const child = spawn(process.execPath, [__filename, ...forward], {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
  })
  child.unref()
  fs.closeSync(out)
  fs.closeSync(err)
  let spawnError = null
  child.on('error', (e) => { spawnError = e })
  const tail = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-15).join('\n')
    } catch {
      return ''
    }
  }
  const deadline = Date.now() + 20000
  const poll = setInterval(() => {
    let ready = null
    try {
      ready = fs.readFileSync(logFile, 'utf8').match(/^\[dashboard\] http:\/\/\S+/m)
    } catch {
      /* 日志尚未写入，继续等待 */
    }
    if (ready) {
      clearInterval(poll)
      console.log(`[dashboard] dataDir=${root}`)
      console.log(ready[0])
      console.log(`[dashboard] detached pid=${child.pid} log=${logFile}`)
      process.exit(0)
    }
    if (spawnError || child.exitCode !== null || Date.now() > deadline) {
      clearInterval(poll)
      try { child.kill() } catch { /* 已退出 */ }
      console.error(`[dashboard] detach 启动失败${spawnError ? `: ${spawnError.message}` : ''}`)
      if (tail(errFile)) console.error(`--- ${errFile} ---\n${tail(errFile)}`)
      if (tail(logFile)) console.error(`--- ${logFile} ---\n${tail(logFile)}`)
      process.exit(1)
    }
  }, 150)
}


// --sessionDir 可选：显式指定会话目录；未传则自动探测（数据目录同级/父级 .harmonybot）
const sessionDirArg = argValue('sessionDir') ?? argValue('session-dir')
const api = createDataApi(dataDir, sessionDirArg ? { sessionDir: sessionDirArg } : {})
// 默认依次探测：单目录布局 '.'（app 内 serve.mjs 与前端同级）→ ../web（旧 skill 布局）→ ../dist（本仓库）
const defaultDir = ['.', '../web', '../dist']
  .map((d) => path.resolve(__dirname, d))
  .find((d) => fs.existsSync(path.join(d, 'index.html')))
const distDir = path.resolve(argValue('dir') ?? defaultDir ?? path.join(__dirname, '..', 'web'))
const host = argValue('host') ?? '127.0.0.1'
const basePort = Number(argValue('port') ?? 8080)
const MAX_PORT_RETRY = 10

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`[dashboard] 前端产物缺失: ${distDir} 下没有 index.html（请先构建或用 --dir 指定）`)
  process.exit(1)
}

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

// 服务器脚本与包描述不作为静态资源对外暴露
const BLOCKED_STATIC = new Set(['/serve.mjs', '/dataApi.mjs', '/package.json'])

// ---- SSE 实时推送：文件变化 → /api/data/events 广播 ----
const sseClients = new Set()
const sseBroadcast = (files) => {
  const msg = `data: ${JSON.stringify({ files })}\n\n`
  for (const res of sseClients) {
    try {
      res.write(msg)
    } catch {
      sseClients.delete(res)
    }
  }
}
const heartbeat = setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n')
    } catch {
      sseClients.delete(res)
    }
  }
}, 30000)
const dataWatcher = api.watch(sseBroadcast)

const server = http.createServer((req, res) => {
  const sseUrl = new URL(req.url ?? '/', 'http://localhost')
  if (sseUrl.pathname === '/api/data/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return
  }

  if (api.handle(req, res)) return

  const url = new URL(req.url ?? '/', 'http://localhost')
  if (BLOCKED_STATIC.has(url.pathname)) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const abs = path.join(distDir, rel)

  const sendFile = (file) => {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.statusCode = 500
        res.end('error')
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', STATIC_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
      res.end(data)
    })
  }

  // 路径穿越防护
  if (abs !== distDir && !abs.startsWith(distDir + path.sep)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }

  fs.stat(abs, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(abs)
    } else if (path.extname(rel)) {
      // 带扩展名的资源缺失 → 404
      res.statusCode = 404
      res.end('not found')
    } else {
      // SPA 回退到 index.html
      sendFile(path.join(distDir, 'index.html'))
    }
  })
})

// listening 只注册一次，避免端口重试导致重复输出
server.once('listening', () => {
  server.on('error', (err) => {
    console.error(`[dashboard] 服务器错误: ${err.message}`)
  })
  console.log(`[dashboard] dataDir=${api.root}`)
  console.log(`[dashboard] http://${host}:${server.address().port}`)
})

server.on('close', () => {
  dataWatcher?.close()
  clearInterval(heartbeat)
  for (const res of sseClients) {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
  sseClients.clear()
})

const listen = (port, attemptsLeft) => {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1)
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[dashboard] 端口 ${port} 起连续 ${MAX_PORT_RETRY + 1} 个均被占用，请用 --port 指定其他端口`)
      process.exit(1)
    } else {
      console.error(`[dashboard] 启动失败: ${err.message}`)
      process.exit(1)
    }
  }
  server.once('error', onError)
  // 成功后移除本轮重试 handler，运行期错误走统一日志
  server.once('listening', () => server.removeListener('error', onError))
  server.listen(port, host)
}

listen(basePort, MAX_PORT_RETRY)
