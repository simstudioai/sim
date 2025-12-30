import { createLogger } from '@sim/logger'
import { BlockType, PARALLEL, type SentinelType } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import {
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
} from '@/executor/utils/subflow-utils'

const logger = createLogger('ParallelConstructor')

export class ParallelConstructor {
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      const parallelNodes = parallelConfig.nodes

      if (parallelNodes.length === 0) {
        continue
      }

      if (!this.hasReachableNodes(parallelNodes, reachableBlocks)) {
        continue
      }

      this.createSentinelPair(dag, parallelId)
    }
  }

  private hasReachableNodes(parallelNodes: string[], reachableBlocks: Set<string>): boolean {
    return parallelNodes.some((nodeId) => reachableBlocks.has(nodeId))
  }

  private createSentinelPair(dag: DAG, parallelId: string): void {
    const startId = buildParallelSentinelStartId(parallelId)
    const endId = buildParallelSentinelEndId(parallelId)

    dag.nodes.set(
      startId,
      this.createSentinelNode({
        id: startId,
        parallelId,
        sentinelType: PARALLEL.SENTINEL.START_TYPE,
        blockType: BlockType.SENTINEL_START,
        name: `${PARALLEL.SENTINEL.START_NAME_PREFIX} (${parallelId})`,
      })
    )

    dag.nodes.set(
      endId,
      this.createSentinelNode({
        id: endId,
        parallelId,
        sentinelType: PARALLEL.SENTINEL.END_TYPE,
        blockType: BlockType.SENTINEL_END,
        name: `${PARALLEL.SENTINEL.END_NAME_PREFIX} (${parallelId})`,
      })
    )
  }

  private createSentinelNode(config: {
    id: string
    parallelId: string
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
          parallelId: config.parallelId,
        },
        config: { params: {} },
      } as any,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isSentinel: true,
        isParallelSentinel: true,
        sentinelType: config.sentinelType,
        parallelId: config.parallelId,
      },
    }
  }
}
