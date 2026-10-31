// 对应 architecture-plan/architecture-plan.json 的架构规划产物

/** 拟议目录树节点（懒加载折叠渲染） */
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
}

/** 选型记录（看板确认后写回） */
export interface ArchitectureSelection {
  proposalId: string
  proposalName?: string
  selectedAt?: string
  source?: string
}

export interface ArchitecturePlan {
  planId: string
  project: {
    name: string
    summary: string
  }
  androidAnalysis: {
    summary: string
    techStack: string[]
    /** 新版产物可能不包含源目录结构 */
    structure?: Array<{ path: string; description: string }>
    risks: string[]
  }
  proposals: ArchitectureProposal[]
  recommendedProposalId: string
  recommendationReason: string
  selectedProposalId: string | null
  selection: ArchitectureSelection | null
}
