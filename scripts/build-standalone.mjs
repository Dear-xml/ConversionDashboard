#!/usr/bin/env node
// 单文件快照模板构建：消费 `vite build --mode singlefile` 的 dist-single/ 产物，
// 把全部 JS/CSS 内联进一个 HTML，并预置数据注入点，输出 dashboard.standalone.html。
// 供 server/serve.mjs --export-snapshot 读取后注入数据，生成 .migration/dashboard.html。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist-single')
const indexFile = path.join(distDir, 'index.html')
if (!fs.existsSync(indexFile)) {
  console.error('[standalone] 缺少 dist-single/index.html；先执行 vite build --mode singlefile')
  process.exit(1)
}
let html = fs.readFileSync(indexFile, 'utf8')

// CSS：<link rel="stylesheet" ... href="./assets/x.css"> → <style> 内联
html = html.replace(
  /<link\b[^>]*href="\.?\/?(?:assets\/([^"]+\.css))"[^>]*\/?>/gi,
  (match, file) => `<style>\n${fs.readFileSync(path.join(distDir, 'assets', file), 'utf8')}\n</style>`,
)

// JS：<script ... src="./assets/x.js"></script> → 内联 module（</script 转义防止提前闭合）
html = html.replace(
  /<script\b[^>]*src="\.?\/?(?:assets\/([^"]+\.js))"[^>]*>\s*<\/script>/gi,
  (match, file) => {
    const js = fs
      .readFileSync(path.join(distDir, 'assets', file), 'utf8')
      .replace(/<\/script/gi, '<\\/script')
    return `<script type="module">\n${js}\n</script>`
  },
)

// 清理 modulepreload（inlineDynamicImports 下通常没有，兜底）
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*\/?>/gi, '')

// 注入快照占位：必须位于第一个 script 之前（module 延迟执行，boot 同步先跑）
const boot = '<script>window.__D2H_SNAPSHOT__ = /*__D2H_SNAPSHOT__*/null;</script>'
const firstScript = html.search(/<script\b/i)
if (firstScript < 0) {
  console.error('[standalone] 模板缺少 script 标签')
  process.exit(1)
}
html = `${html.slice(0, firstScript)}${boot}\n  ${html.slice(firstScript)}`

// 校验：无残留外部资源引用；注入点恰好一处
if (/(?:src|href)="\.?\/?assets\//.test(html)) {
  console.error('[standalone] 仍有未内联的 assets 引用')
  process.exit(1)
}
const marker = '/*__D2H_SNAPSHOT__*/null'
if (html.split(marker).length !== 2) {
  console.error('[standalone] 注入点数量异常（应恰好 1 处）')
  process.exit(1)
}

const out = path.resolve(__dirname, '..', 'dashboard.standalone.html')
fs.writeFileSync(out, html)
console.log(`[standalone] 写出 ${out}（${(fs.statSync(out).size / 1024).toFixed(1)} KiB）`)
