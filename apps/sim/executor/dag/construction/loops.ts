import { createLogger } from '@sim/logger'
import { BlockType, LOOP, type SentinelType } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import { buildSentinelEndId, buildSentinelStartId } from '@/executor/utils/subflow-utils'

const logger = createLogger('LoopConstructor')

export class LoopConstructor {
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      if (!reachableBlocks.has(loopId)) {
        continue
      }

      const loopNodes = loopConfig.nodes
      const hasReachableChildren = loopNodes.some((nodeId) => reachableBlocks.has(nodeId))

      if (!hasReachableChildren) {
        loopConfig.nodes = []
      }

      this.createSentinelPair(dag, loopId)
    }
  }

  private createSentinelPair(dag: DAG, loopId: string): void {
    const startId = buildSentinelStartId(loopId)
    const endId = buildSentinelEndId(loopId)

    dag.nodes.set(
      startId,
      this.createSentinelNode({
        id: startId,
        loopId,
        sentinelType: LOOP.SENTINEL.START_TYPE,
        blockType: BlockType.SENTINEL_START,
        name: `${LOOP.SENTINEL.START_NAME_PREFIX} (${loopId})`,
      })
    )

    dag.nodes.set(
      endId,
      this.createSentinelNode({
        id: endId,
        loopId,
        sentinelType: LOOP.SENTINEL.END_TYPE,
        blockType: BlockType.SENTINEL_END,
        name: `${LOOP.SENTINEL.END_NAME_PREFIX} (${loopId})`,
      })
    )
  }

  private createSentinelNode(config: {
    id: string
    loopId: string
    sentinelType: SentinelType
    blockType: BlockType
    name: string
  }): DAGNode {
    return {
      id: config.id,
      block: {
        id: config.id,
        enabled: true,
        metadata: {
          id: config.blockType,
          name: config.name,
          loopId: config.loopId,
        },
        config: { params: {} },
      } as any,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isSentinel: true,
        sentinelType: config.sentinelType,
        loopId: config.loopId,
      },
    }
  }
}
