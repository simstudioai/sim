export interface DAGEdge {
  target: string
  sourceHandle?: string
  targetHandle?: string
  isActive?: boolean
}

export interface NodeMetadata {
  isParallelBranch?: boolean
  parallelId?: string
  branchIndex?: number
  branchTotal?: number
  distributionItem?: unknown
  isLoopNode?: boolean
  loopId?: string
  isSentinel?: boolean
  sentinelType?: 'start' | 'end'
  isPauseResponse?: boolean
  isResumeTrigger?: boolean
  originalBlockId?: string
}
