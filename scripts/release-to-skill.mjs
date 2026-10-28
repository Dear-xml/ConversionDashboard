#!/usr/bin/env node
// 构建前端并把产物 + 服务器脚本发布到 skill 资产目录：
//   npm run release -- --target <skill>/assets/dashboard
// 产物布局：target/web（前端 dist）+ target/server（dataApi.mjs / serve.mjs）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

function argValue(name) {
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) return argv[i + 1]
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3)
  }
  return undefined
}

const target = argValue('target')
if (!target) {
  console.error('[release] 缺少 --target 参数（skill 的 assets/dashboard 目录）')
  process.exit(1)
}

console.log('[release] 构建前端…')
execSync('npx vite build', { cwd: projectRoot, stdio: 'inherit' })

const webDir = path.resolve(target, 'web')
const serverDir = path.resolve(target, 'server')
fs.rmSync(webDir, { recursive: true, force: true })
fs.rmSync(serverDir, { recursive: true, force: true })
fs.mkdirSync(webDir, { recursive: true })
fs.mkdirSync(serverDir, { recursive: true })

fs.cpSync(path.join(projectRoot, 'dist'), webDir, { recursive: true })
for (const f of ['dataApi.mjs', 'serve.mjs']) {
  fs.copyFileSync(path.join(projectRoot, 'server', f), path.join(serverDir, f))
}

console.log(`[release] 完成: ${path.resolve(target)}`)
console.log(`[release] web ← dist (${fs.readdirSync(webDir).length} 项)`)
console.log('[release] server ← dataApi.mjs + serve.mjs')
