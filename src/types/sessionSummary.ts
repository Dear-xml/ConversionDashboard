// 对应 .harmonybot 会话目录的聚合产物（服务端虚拟文件 .harmonybot/_summary.json）
export interface SessionSummary {
  schema_version: string
  sessionCount: number
  durationMs: number
  taskDurationMs: number
  latestEndTime: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}
