import type { BlockType, SentinelType } from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import type { SentinelSubflowType } from '@/executor/dag/types'

interface SubflowSentinelNodeConfig {
  id: string
  subflowId: string
  subflowType: SentinelSubflowType
  sentinelType: SentinelType
  blockType: BlockType
  name: string
}

export function createSubflowSentinelNode(config: SubflowSentinelNodeConfig): DAGNode {
  const legacyId =
    config.subflowType === 'loop' ? { loopId: config.subflowId } : { parallelId: config.subflowId }

  return {
    id: config.id,
    block: {
      id: config.id,
      enabled: true,
      metadata: {
        id: config.blockType,
        name: config.name,
        subflowId: config.subflowId,
        subflowType: config.subflowType,
        ...legacyId,
      },
      config: { params: {} },
    } as any,
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {
      isSentinel: true,
      sentinelType: config.sentinelType,
      subflowId: config.subflowId,
      subflowType: config.subflowType,
      ...legacyId,
    },
  }
}
