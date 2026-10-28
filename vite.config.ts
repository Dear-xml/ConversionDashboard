import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createDataApi, type DataApi } from './server/dataApi.mjs'

/** 解析 CLI 参数：--name value 或 --name=value */
function argValue(name: string): string | undefined {
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) return argv[i + 1]
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3)
  }
  return undefined
}

function dashboardData(api: DataApi): Plugin {
  return {
    name: 'dashboard-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!api.handle(req, res)) next()
      })

      // 文件变化 → Vite WS 推送（dev 独有，前端毫秒级刷新）
      api.watch((files) => {
        server.ws.send({ type: 'custom', event: 'dashboard:data-changed', data: { files } })
      })

      console.log(`[dashboard-data] dataDir=${api.root}`)
    },
    configurePreviewServer(server) {
      // preview 无 HMR 客户端，前端自动退化为轮询
      server.middlewares.use((req, res, next) => {
        if (!api.handle(req, res)) next()
      })
    },
  }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dataDir =
    argValue('dataDir') ??
    argValue('data-dir') ??
    process.env.npm_config_dataDir ??
    process.env.DASHBOARD_DATA_DIR ??
    env.DASHBOARD_DATA_DIR

  // build 不需要数据目录；dev/preview 缺参时 fail fast
  if (!dataDir && command !== 'build') {
    throw new Error(
      '[dashboard-data] 缺少数据目录：npm run dev -- --dataDir <迁移工程>/.migration（或设置 DASHBOARD_DATA_DIR / .env）',
    )
  }

  const plugins: Plugin[] = [vue()]
  if (dataDir) {
    plugins.push(dashboardData(createDataApi(dataDir)))
  }
  return { plugins }
})
