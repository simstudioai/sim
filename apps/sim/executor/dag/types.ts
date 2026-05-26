export interface DAGEdge {
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export type SentinelSubflowType = 'loop' | 'parallel'

export interface NodeMetadata {
  isParallelBranch?: boolean
  branchIndex?: number
  branchTotal?: number
  distributionItem?: unknown
  isLoopNode?: boolean
  isSentinel?: boolean
  sentinelType?: 'start' | 'end'
  subflowType?: SentinelSubflowType
  subflowId?: string
  isPauseResponse?: boolean
  isResumeTrigger?: boolean
  originalBlockId?: string
}
