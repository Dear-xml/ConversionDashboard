#!/usr/bin/env node
// vite dev/preview 包装：支持 --dataDir 直传（Vite 8 CLI 拒绝未知选项，需转为环境变量）
//   npm run dev:data -- --dataDir <project>/.migration --port 5173
//   npm run preview:data -- --dataDir <project>/.migration
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const viteBin = path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')

const argv = process.argv.slice(2)
const command = argv[0] === 'preview' ? 'preview' : 'dev'

let dataDir
const forward = []
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dataDir' || a === '--data-dir') {
    dataDir = argv[++i]
  } else if (a.startsWith('--dataDir=')) {
    dataDir = a.slice(10)
  } else if (a.startsWith('--data-dir=')) {
    dataDir = a.slice(11)
  } else {
    forward.push(a)
  }
}

if (!dataDir && !process.env.DASHBOARD_DATA_DIR) {
  console.error('[vite-with-data] 缺少 --dataDir（或设置 DASHBOARD_DATA_DIR 环境变量）')
  process.exit(1)
}
if (dataDir) process.env.DASHBOARD_DATA_DIR = dataDir

const child = spawn(process.execPath, [viteBin, command, ...forward], {
  stdio: 'inherit',
  env: { ...process.env },
})
child.on('exit', (code) => process.exit(code ?? 0))
