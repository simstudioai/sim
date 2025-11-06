import { createLogger } from '@/lib/logs/console/logger'
import { isMetadataOnlyBlockType, isTriggerBlockType } from '@/executor/consts'
import { extractBaseBlockId } from '@/executor/utils/subflow-utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('PathConstructor')

export class PathConstructor {
  execute(workflow: SerializedWorkflow, triggerBlockId?: string): Set<string> {
    const resolvedTriggerId = this.findTriggerBlock(workflow, triggerBlockId)

    if (!resolvedTriggerId) {
      logger.warn('No trigger block found, including all enabled blocks as fallback')
      return this.getAllEnabledBlocks(workflow)
    }

    const adjacency = this.buildAdjacencyMap(workflow)
    const reachable = this.performBFS(resolvedTriggerId, adjacency)

    return reachable
  }

  private findTriggerBlock(
    workflow: SerializedWorkflow,
    triggerBlockId?: string
  ): string | undefined {
    if (triggerBlockId) {
      const block = workflow.blocks.find((b) => b.id === triggerBlockId)

      if (block) {
        return triggerBlockId
      }

      const fallbackTriggerId = this.resolveResumeTriggerFallback(triggerBlockId, workflow)

      if (fallbackTriggerId) {
        return fallbackTriggerId
      }

      logger.error('Provided triggerBlockId not found in workflow', {
        triggerBlockId,
        availableBlocks: workflow.blocks.map((b) => ({ id: b.id, type: b.metadata?.id })),
      })

      throw new Error(`Trigger block not found: ${triggerBlockId}`)
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

    return adjacency
  }

  private performBFS(triggerBlockId: string, adjacency: Map<string, string[]>): Set<string> {
    const reachable = new Set<string>([triggerBlockId])
    const queue = [triggerBlockId]

    while (queue.length > 0) {
      const currentBlockId = queue.shift()

      if (!currentBlockId) break

      const neighbors = adjacency.get(currentBlockId) ?? []

      for (const neighborId of neighbors) {
        if (!reachable.has(neighborId)) {
          reachable.add(neighborId)
          queue.push(neighborId)
        }
      }
    }

    return reachable
  }

  private resolveResumeTriggerFallback(
    triggerBlockId: string,
    workflow: SerializedWorkflow
  ): string | undefined {
    if (!triggerBlockId.endsWith('__trigger')) {
      return undefined
    }

    const baseId = triggerBlockId.replace(/__trigger$/, '')
    const normalizedBaseId = extractBaseBlockId(baseId)
    const candidates = baseId === normalizedBaseId ? [baseId] : [baseId, normalizedBaseId]

    for (const candidate of candidates) {
      const block = workflow.blocks.find((b) => b.id === candidate)

      if (block) {
        return candidate
      }
    }

    return undefined
  }
}
