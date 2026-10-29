// 对应 .migration/preflight-report.json 的预检报告产物
export interface PreflightReport {
  createdAt: string
  configRef: string
  checklistRef: string
  projectRoot: string
  harmonyProject: string
  gitHead: string
  result: string
  checks: Array<{
    id: string
    status: string
    summary: string
    /** 对象（如 android-ui-stack 的 {kotlin, layoutXml, compose}）或字符串数组 */
    evidence: Record<string, string[]> | string[]
  }>
}
