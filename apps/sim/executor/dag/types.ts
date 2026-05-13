export interface DAGEdge {
  target: string
  sourceHandle?: string
  targetHandle?: string
  isActive?: boolean
}

export type SentinelSubflowType = 'loop' | 'parallel'

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
  subflowType?: SentinelSubflowType
  subflowId?: string
  isPauseResponse?: boolean
  isResumeTrigger?: boolean
  originalBlockId?: string
}
