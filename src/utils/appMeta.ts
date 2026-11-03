import type { DataManifest } from './JsonOperateUtils'

export interface AppMeta {
  /** 数据根目录（manifest.root） */
  dataRoot: string | null
  /** 工程路径：root 去掉尾部 .migration */
  projectPath: string | null
  /** 工程名称：projectPath 的末级目录名（侧栏副标题默认展示，不截断） */
  projectName: string | null
  /** 应用图标 URL（--icon 配置时为 /app-icon；未配置 null，前端用内置默认图标） */
  iconUrl: string | null
}

/**
 * 启动时拉取一次应用元信息：
 * - 项目路径来自 manifest.root（自动读取，无需参数），去掉尾部 .migration
 * - 图标探测 /app-icon（serve.mjs --icon / vite DASHBOARD_ICON 配置时可用），404 则 null
 */
export async function fetchAppMeta(signal?: AbortSignal): Promise<AppMeta> {
  let dataRoot: string | null = null
  try {
    const res = await fetch('/api/data/manifest', { cache: 'no-store', signal })
    if (res.ok) {
      const manifest = (await res.json()) as DataManifest
      dataRoot = manifest.root ?? null
    }
  } catch {
    // manifest 不可用：路径回退默认副标题
  }
  let iconUrl: string | null = null
  try {
    const res = await fetch('/app-icon', { cache: 'no-store', signal })
    if (res.ok) iconUrl = '/app-icon'
  } catch {
    // 图标端点不存在：使用内置默认图标
  }
  const projectPath =
    dataRoot && dataRoot.endsWith('.migration')
      ? dataRoot.slice(0, -'.migration'.length).replace(/[\\/]$/, '')
      : dataRoot
  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() ?? null : null
  return { dataRoot, projectPath, projectName, iconUrl }
}
