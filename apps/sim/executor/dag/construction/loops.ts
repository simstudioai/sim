/**
 * LoopConstructor
 * 
 * Creates sentinel nodes (start/end gates) for each loop.
 * Sentinels control loop entry, continuation, and exit.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedLoop } from '@/serializer/types'
import type { DAG, DAGNode } from '../builder'
import { BlockType, LOOP, type SentinelType } from '@/executor/consts'
import { buildSentinelStartId, buildSentinelEndId } from '@/executor/utils/subflow-utils'

const logger = createLogger('LoopConstructor')

export class LoopConstructor {
  /**
   * Create sentinel nodes for all loops with reachable nodes
   */
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const loopNodes = loopConfig.nodes

      if (loopNodes.length === 0) {
        continue
      }

      if (!this.hasReachableNodes(loopNodes, reachableBlocks)) {
        logger.debug('Skipping sentinel creation for unreachable loop', { loopId })
        continue
      }

      this.createSentinelPair(dag, loopId)
    }
  }

  /**
   * Check if loop has at least one reachable node
   */
  private hasReachableNodes(loopNodes: string[], reachableBlocks: Set<string>): boolean {
    return loopNodes.some((nodeId) => reachableBlocks.has(nodeId))
  }

  /**
   * Create start and end sentinel nodes for a loop
   */
  private createSentinelPair(dag: DAG, loopId: string): void {
    const startId = buildSentinelStartId(loopId)
    const endId = buildSentinelEndId(loopId)

    dag.nodes.set(startId, this.createSentinelNode({
      id: startId,
      loopId,
      sentinelType: LOOP.SENTINEL.START_TYPE,
      blockType: BlockType.SENTINEL_START,
      name: `Loop Start (${loopId})`,
    }))

    dag.nodes.set(endId, this.createSentinelNode({
      id: endId,
      loopId,
      sentinelType: LOOP.SENTINEL.END_TYPE,
      blockType: BlockType.SENTINEL_END,
      name: `Loop End (${loopId})`,
    }))

    logger.debug('Created sentinel pair for loop', {
      loopId,
      startId,
      endId,
    })
  }

  /**
   * Create a sentinel node with specified configuration
   */
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
      } as any, // SerializedBlock type - sentinels don't match exact schema
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
