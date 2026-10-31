export interface FileStamp {
  mtimeMs: number
  size: number
}

export interface DataApi {
  root: string
  sessionDir: string | null
  listFiles(): Record<string, FileStamp>
  handle(req: unknown, res: unknown): boolean
  watch(onChange: (relPaths: string[]) => void): { close(): void } | null
}

export declare function createDataApi(
  dataDir: string,
  options?: {
    sessionDir?: string | null
    /** string[]＝feature 增量更新模式；{ mode: 'patch', fields }＝顶层字段补丁模式 */
    writable?: Record<string, string[] | { mode: 'patch'; fields: string[] }>
  },
): DataApi
