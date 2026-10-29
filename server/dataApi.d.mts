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
  options?: { sessionDir?: string | null; writable?: Record<string, string[]> },
): DataApi
