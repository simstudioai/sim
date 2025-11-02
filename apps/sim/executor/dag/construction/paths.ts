import { createLogger } from '@/lib/logs/console/logger'
import { isMetadataOnlyBlockType, isTriggerBlockType } from '@/executor/consts'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('PathConstructor')

export class PathConstructor {
  execute(workflow: SerializedWorkflow, triggerBlockId?: string): Set<string> {
    const resolvedTriggerId = this.findTriggerBlock(workflow, triggerBlockId)
    if (!resolvedTriggerId) {
      logger.warn('No trigger block found, including all enabled blocks as fallback')
      return this.getAllEnabledBlocks(workflow)
    }
    logger.debug('Starting reachability traversal', { triggerBlockId: resolvedTriggerId })
    const adjacency = this.buildAdjacencyMap(workflow)
    const reachable = this.performBFS(resolvedTriggerId, adjacency)
    logger.debug('Reachability analysis complete', {
      triggerBlockId: resolvedTriggerId,
      reachableCount: reachable.size,
      totalBlocks: workflow.blocks.length,
    })
    return reachable
  }

  private findTriggerBlock(
    workflow: SerializedWorkflow,
    triggerBlockId?: string
  ): string | undefined {
    if (triggerBlockId) {
      const block = workflow.blocks.find((b) => b.id === triggerBlockId)
      if (!block) {
        logger.error('Provided triggerBlockId not found in workflow', {
          triggerBlockId,
          availableBlocks: workflow.blocks.map((b) => ({ id: b.id, type: b.metadata?.id })),
        })
        throw new Error(`Trigger block not found: ${triggerBlockId}`)
      }

      logger.debug('Using explicitly provided trigger block', {
        triggerBlockId,
        blockType: block.metadata?.id,
      })
      return triggerBlockId
    }

    const explicitTrigger = this.findExplicitTrigger(workflow)
    if (explicitTrigger) {
      return explicitTrigger
    }
    const rootBlock = this.findRootBlock(workflow)
    if (rootBlock) {
      return rootBlock
    }
    return undefined
  }

  private findExplicitTrigger(workflow: SerializedWorkflow): string | undefined {
    for (const block of workflow.blocks) {
      if (block.enabled && this.isTriggerBlock(block)) {
        logger.debug('Found explicit trigger block', {
          blockId: block.id,
          blockType: block.metadata?.id,
        })
        return block.id
      }
    }
    return undefined
  }

  private findRootBlock(workflow: SerializedWorkflow): string | undefined {
    const hasIncoming = new Set(workflow.connections.map((c) => c.target))
    for (const block of workflow.blocks) {
      if (
        !hasIncoming.has(block.id) &&
        block.enabled &&
        !isMetadataOnlyBlockType(block.metadata?.id)
      ) {
        logger.debug('Found root block (no incoming connections)', {
          blockId: block.id,
          blockType: block.metadata?.id,
        })
        return block.id
      }
    }
    return undefined
  }

  private isTriggerBlock(block: SerializedBlock): boolean {
    return isTriggerBlockType(block.metadata?.id)
  }
  private getAllEnabledBlocks(workflow: SerializedWorkflow): Set<string> {
    return new Set(workflow.blocks.filter((b) => b.enabled).map((b) => b.id))
  }

  private buildAdjacencyMap(workflow: SerializedWorkflow): Map<string, string[]> {
    const adjacency = new Map<string, string[]>()
    for (const connection of workflow.connections) {
      const neighbors = adjacency.get(connection.source) ?? []
      neighbors.push(connection.target)
      adjacency.set(connection.source, neighbors)
    }
    logger.debug('Built adjacency map', {
      nodeCount: adjacency.size,
      connectionCount: workflow.connections.length,
    })
    return adjacency
  }

  private performBFS(triggerBlockId: string, adjacency: Map<string, string[]>): Set<string> {
    const reachable = new Set<string>([triggerBlockId])
    const queue = [triggerBlockId]

    logger.debug('Starting BFS traversal', {
      triggerBlockId,
      adjacencyMapSize: adjacency.size,
      adjacencyEntries: Array.from(adjacency.entries()).map(([source, targets]) => ({
        source,
        targets,
      })),
    })

    while (queue.length > 0) {
      const currentBlockId = queue.shift()
      if (!currentBlockId) break

      const neighbors = adjacency.get(currentBlockId) ?? []
      logger.debug('BFS processing node', {
        currentBlockId,
        neighbors,
        neighborCount: neighbors.length,
      })

      for (const neighborId of neighbors) {
        if (!reachable.has(neighborId)) {
          logger.debug('BFS found new reachable node', {
            from: currentBlockId,
            to: neighborId,
          })
          reachable.add(neighborId)
          queue.push(neighborId)
        }
      }
    }

    logger.debug('BFS traversal complete', {
      triggerBlockId,
      reachableCount: reachable.size,
      reachableBlocks: Array.from(reachable),
    })
    return reachable
  }
}
