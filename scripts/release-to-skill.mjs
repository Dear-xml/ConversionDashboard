#!/usr/bin/env node
// 构建前端并把产物 + 服务器脚本发布到 skill 资产目录（单目录布局）：
//   npm run release -- --target <skill>/assets/dashboard
// 产物布局：target/app（index.html + assets + serve.mjs + dataApi.mjs + package.json）
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

const appDir = path.resolve(target, 'app')
fs.rmSync(appDir, { recursive: true, force: true })
fs.mkdirSync(appDir, { recursive: true })

// 前端产物
fs.cpSync(path.join(projectRoot, 'dist'), appDir, { recursive: true })
// 服务器脚本
for (const f of ['dataApi.mjs', 'serve.mjs']) {
  fs.copyFileSync(path.join(projectRoot, 'server', f), path.join(appDir, f))
}
// 包描述（bin + start，供 npm start / npx 调用）
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'd2h-dashboard',
      version: '0.1.0',
      private: true,
      description: '迁移实时看板（零依赖本地服务器 + 静态前端）',
      bin: { 'd2h-dashboard': './serve.mjs' },
      scripts: { start: 'node serve.mjs' },
    },
    null,
    2,
  ) + '\n',
)

console.log(`[release] 完成: ${path.resolve(appDir)}`)
console.log(`[release] 前端 + serve.mjs + dataApi.mjs + package.json → app/ (${fs.readdirSync(appDir).length} 项)`)
