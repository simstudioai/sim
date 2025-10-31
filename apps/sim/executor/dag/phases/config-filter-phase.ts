/**
 * ConfigFilterPhase
 * 
 * Filters loop and parallel configurations to only include reachable blocks.
 * Removes or updates configs based on reachability analysis.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { DAG } from '../dag-builder'

const logger = createLogger('ConfigFilterPhase')

export class ConfigFilterPhase {
  /**
   * Filter loop and parallel configs to only reachable blocks
   */
  execute(dag: DAG, reachableBlocks: Set<string>): void {
    this.filterLoopConfigs(dag, reachableBlocks)
    this.filterParallelConfigs(dag, reachableBlocks)
  }

  private filterLoopConfigs(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [loopId, loopConfig] of dag.loopConfigs) {
      const loopNodes = (loopConfig as any).nodes || []
      const reachableLoopNodes = loopNodes.filter((nodeId: string) => reachableBlocks.has(nodeId))

      if (reachableLoopNodes.length === 0) {
        logger.debug('Removing unreachable loop:', { loopId, totalNodes: loopNodes.length })
        dag.loopConfigs.delete(loopId)
      } else if (reachableLoopNodes.length < loopNodes.length) {
        // Partial reachability - update config with only reachable nodes
        logger.debug('Filtering loop to reachable nodes:', {
          loopId,
          originalNodes: loopNodes.length,
          reachableNodes: reachableLoopNodes.length,
        })
        ;(loopConfig as any).nodes = reachableLoopNodes
      }
    }
  }

  private filterParallelConfigs(dag: DAG, reachableBlocks: Set<string>): void {
    for (const [parallelId, parallelConfig] of dag.parallelConfigs) {
      const parallelNodes = (parallelConfig as any).nodes || []
      const reachableParallelNodes = parallelNodes.filter((nodeId: string) =>
        reachableBlocks.has(nodeId)
      )

      if (reachableParallelNodes.length === 0) {
        logger.debug('Removing unreachable parallel:', {
          parallelId,
          totalNodes: parallelNodes.length,
        })
        dag.parallelConfigs.delete(parallelId)
      } else if (reachableParallelNodes.length < parallelNodes.length) {
        // Partial reachability - update config with only reachable nodes
        logger.debug('Filtering parallel to reachable nodes:', {
          parallelId,
          originalNodes: parallelNodes.length,
          reachableNodes: reachableParallelNodes.length,
        })
        ;(parallelConfig as any).nodes = reachableParallelNodes
      }
    }
  }
}

