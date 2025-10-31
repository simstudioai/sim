/**
 * LoopSentinelPhase
 * 
 * Creates sentinel nodes (start/end) for each loop.
 * Sentinels act as gates that manage loop entry, exit, and continuation.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { DAG } from '../dag-builder'

const logger = createLogger('LoopSentinelPhase')

export class LoopSentinelPhase {
  /**
   * Create sentinel nodes for all reachable loops
   */
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const config = loopConfig as any
      const nodes = config.nodes || []

      if (nodes.length === 0) continue

      // Only create sentinels if at least one node in the loop is reachable
      const hasReachableNodes = nodes.some((nodeId: string) => reachableBlocks.has(nodeId))
      if (!hasReachableNodes) {
        logger.debug('Skipping sentinel creation for unreachable loop', { loopId })
        continue
      }

      this.createSentinelNodes(dag, loopId, nodes)
    }
  }

  private createSentinelNodes(dag: DAG, loopId: string, nodes: string[]): void {
    const sentinelStartId = `loop-${loopId}-sentinel-start`
    const sentinelEndId = `loop-${loopId}-sentinel-end`

    // Create sentinel_start node
    dag.nodes.set(sentinelStartId, {
      id: sentinelStartId,
      block: {
        id: sentinelStartId,
        enabled: true,
        metadata: {
          id: 'sentinel_start',
          name: `Loop Start (${loopId})`,
          loopId,
        },
        config: { params: {} },
      } as any,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isSentinel: true,
        sentinelType: 'start',
        loopId,
      },
    })

    // Create sentinel_end node
    dag.nodes.set(sentinelEndId, {
      id: sentinelEndId,
      block: {
        id: sentinelEndId,
        enabled: true,
        metadata: {
          id: 'sentinel_end',
          name: `Loop End (${loopId})`,
          loopId,
        },
        config: { params: {} },
      } as any,
      incomingEdges: new Set(),
      outgoingEdges: new Map(),
      metadata: {
        isSentinel: true,
        sentinelType: 'end',
        loopId,
      },
    })

    logger.debug('Created sentinel nodes for loop', {
      loopId,
      sentinelStartId,
      sentinelEndId,
      loopNodes: nodes,
    })
  }
}

