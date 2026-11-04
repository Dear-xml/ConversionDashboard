// 对应 architecture-plan/architecture-plan.json 的架构规划产物（删减版 schema）

/** 拟议目录树节点 */
export interface DirectoryNode {
  name: string
  path: string
  description: string
  children: DirectoryNode[]
}

/** 一套候选架构方案 */
export interface ArchitectureProposal {
  id: string
  name: string
  summary: string
  directoryTree: DirectoryNode
  decisions: Array<{
    title: string
    description: string
  }>
}

export interface ArchitecturePlan {
  project: {
    name: string
    summary: string
    androidRoot: string
    targetRoot: string
    scope: string[]
  }
  attentionPoints: Array<{
    title: string
    description: string
  }>
  proposals: ArchitectureProposal[]
}
