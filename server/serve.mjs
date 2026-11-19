#!/usr/bin/env node
// 独立迁移看板服务器（零依赖，Node >= 18）：
//   node server/serve.mjs --dataDir <project>/.migration [--port 8080] [--host 127.0.0.1] [--dir ../web]
//   node server/serve.mjs --dataDir <project>/.migration --detach [--log-file <path>]
//   node server/serve.mjs --dataDir <project>/.migration --export-snapshot [--out <path>] [--no-open]
// --dataDir 缺省为当前目录：cd <项目>-migration/.migration && npx d2h-dashboard --export-snapshot
//   即可为历史迁移数据（无 dashboard.html）现场生成并查看。
// --detach：自守护启动——父进程 spawn 分离子进程（stdout/stderr 直写日志文件），
//   轮询日志直到子进程就绪后原样打印 stdout 契约并退出；调用方无需 shell 重定向/引号转义。
//   默认日志 %TEMP%/d2h-dashboard-<dataDir哈希8位>.log（每次启动截断重写，跨项目天然隔离）。
// --export-snapshot：枚举数据目录白名单文件（.json/.jsonl/.md，含会话汇总虚拟文件），
//   注入 dashboard.standalone.html 模板，写出单文件离线快照（默认 <dataDir>/dashboard.html）。
//   拷走整个 .migration 后双击该 HTML 即可离线查看当时进展；运行期服务器仍只读。
//   生成后默认用系统浏览器打开快照（--no-open 关闭；打开失败不影响导出）。
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
  process.env.DASHBOARD_DATA_DIR ??
  process.cwd() // 默认当前目录：支持 cd <项目>-migration/.migration && npx d2h-dashboard ...
if (!fs.existsSync(dataDir)) {
  console.error(`[dashboard] 数据目录不存在: ${dataDir}`)
  process.exit(1)
}

// ---- --export-snapshot：枚举数据目录白名单文件 → 注入 standalone 模板 → 写出单文件离线快照 ----
// 运行期服务器保持只读；本命令是唯一显式写出：默认产出 <dataDir>/dashboard.html（可 --out 覆盖）。
if (process.argv.includes('--export-snapshot')) {
  const root = path.resolve(dataDir)
  const outPath = path.resolve(argValue('out') ?? path.join(root, 'dashboard.html'))
  const templatePath = [
    path.resolve(__dirname, 'dashboard.standalone.html'), // 内嵌 skill 布局：与 serve.mjs 同目录（app/）
    path.resolve(__dirname, '..', 'dashboard.standalone.html'), // npm 包布局：包根
  ].find((p) => fs.existsSync(p))
  if (!templatePath) {
    console.error('[dashboard] 缺少 dashboard.standalone.html 模板（包应含该文件；源码运行请先 npm run build）')
    process.exit(1)
  }
  const exportApi = createDataApi(dataDir, {})
  const stamps = exportApi.listFiles()
  const files = {}
  const skipped = []
  const readVirtual = (rel) => new Promise((resolve) => {
    const res = {
      statusCode: 0,
      chunks: [],
      setHeader() {},
      end(chunk) {
        if (chunk) this.chunks.push(chunk)
        resolve(this.statusCode === 200 ? this.chunks.join('') : null)
      },
    }
    exportApi.handle({ url: `/api/data/file?p=${encodeURIComponent(rel)}` }, res)
  })
  for (const rel of Object.keys(stamps)) {
    try {
      let text = null
      if (rel === '.harmonybot/_summary.json') {
        text = await readVirtual(rel)
      } else {
        text = fs.readFileSync(path.resolve(root, rel), 'utf8')
      }
      if (text === null) { skipped.push(rel); continue }
      files[rel] = { text, mtimeMs: stamps[rel].mtimeMs, size: stamps[rel].size }
    } catch {
      skipped.push(rel)
    }
  }
  const payload = { generatedAt: new Date().toISOString(), root, files }
  let payloadJson = JSON.stringify(payload)
  for (const [source, escaped] of [['&', '\\u0026'], ['<', '\\u003c'], ['>', '\\u003e'], ['\u2028', '\\u2028'], ['\u2029', '\\u2029']]) {
    payloadJson = payloadJson.split(source).join(escaped)
  }
  const template = fs.readFileSync(templatePath, 'utf8')
  const marker = '/*__D2H_SNAPSHOT__*/null'
  if (template.split(marker).length !== 2) {
    console.error('[dashboard] 模板注入点异常（应恰好 1 处）')
    process.exit(1)
  }
  const html = template.replace(marker, payloadJson)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const temp = `${outPath}.tmp-${process.pid}`
  fs.writeFileSync(temp, html)
  fs.renameSync(temp, outPath)
  // 默认用系统默认浏览器打开快照（--no-open 关闭）；打开失败不影响导出结果
  let opened = false
  if (!process.argv.includes('--no-open')) {
    try {
      const opener =
        process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', outPath], { detached: true, stdio: 'ignore', windowsHide: true })
          : process.platform === 'darwin'
            ? spawn('open', [outPath], { detached: true, stdio: 'ignore' })
            : spawn('xdg-open', [outPath], { detached: true, stdio: 'ignore' })
      opener.unref()
      opened = true
    } catch {
      // 无图形环境/无默认浏览器：只记录在结果里
    }
  }
  console.log(JSON.stringify({
    ok: true,
    out: outPath,
    template: templatePath,
    files: Object.keys(files).length,
    skipped,
    bytes: Buffer.byteLength(html),
    opened,
  }, null, 2))
  process.exit(0)
}

// ---- --detach：spawn 分离子进程并等待就绪，然后父进程退出 ----
const isDetach = process.argv.includes('--detach')
if (isDetach) {
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
const heartbeat = isDetach ? null : setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n')
    } catch {
      sseClients.delete(res)
    }
  }
}, 30000)
const dataWatcher = isDetach ? null : api.watch(sseBroadcast)

// --icon 可选：应用图标（本地 png/svg/jpg 路径或 http(s) URL），未传则 /app-icon 返回 404（前端回退文字品牌）
const iconArg = argValue('icon')
const ICON_MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const iconAbs = iconArg && !/^https?:\/\//i.test(iconArg) ? path.resolve(iconArg) : null
if (iconArg && !iconAbs && !/^https?:\/\//i.test(iconArg)) {
  console.error(`[dashboard] --icon 仅支持本地文件路径或 http(s) URL: ${iconArg}`)
  process.exit(1)
}
if (iconAbs && !fs.existsSync(iconAbs)) {
  console.error(`[dashboard] --icon 文件不存在: ${iconAbs}`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const sseUrl = new URL(req.url ?? '/', 'http://localhost')
  if (sseUrl.pathname === '/app-icon') {
    if (!iconArg) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    if (iconAbs) {
      fs.readFile(iconAbs, (err, data) => {
        if (err) {
          res.statusCode = 500
          res.end('error')
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', ICON_MIME[path.extname(iconAbs).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        res.end(data)
      })
    } else {
      res.statusCode = 302
      res.setHeader('Location', iconArg)
      res.end()
    }
    return
  }
  if (sseUrl.pathname === '/api/data/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    sseClients.add(res)
    res.on('close', () => sseClients.delete(res))
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

if (isDetach) {
  // detach 模式：父进程不启动服务器，生命周期由上方 poll 接管（成功/失败都会 process.exit）
} else {
  listen(basePort, MAX_PORT_RETRY)
}
