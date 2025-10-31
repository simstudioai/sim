/**
 * Parallel Resolver
 * 
 * Resolves references to parallel variables: <parallel.index>, <parallel.currentItem>, <parallel.items>
 * - Extracts branch index from node ID
 * - Returns current item from distribution items
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow } from '@/serializer/types'
import type { Resolver, ResolutionContext } from './reference'

const logger = createLogger('ParallelResolver')

const REFERENCE_START = '<'
const REFERENCE_END = '>'
const PATH_DELIMITER = '.'
const PARALLEL_PREFIX = 'parallel'

export class ParallelResolver implements Resolver {
  constructor(private workflow: SerializedWorkflow) {}

  canResolve(reference: string): boolean {
    if (!this.isReference(reference)) {
      return false
    }

    const content = this.extractContent(reference)
    const parts = content.split(PATH_DELIMITER)

    if (parts.length === 0) {
      return false
    }

    const [type] = parts
    return type === PARALLEL_PREFIX
  }

  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(PATH_DELIMITER)

    if (parts.length < 2) {
      logger.warn('Invalid parallel reference - missing property', { reference })
      return undefined
    }

    const [_, property] = parts

    // Find parallel ID for current node
    const parallelId = this.findParallelForBlock(context.currentNodeId)
    if (!parallelId) {
      logger.debug('Block not in a parallel', { nodeId: context.currentNodeId })
      return undefined
    }

    // Get parallel config
    const parallelConfig = this.workflow.parallels?.[parallelId]
    if (!parallelConfig) {
      logger.warn('Parallel config not found', { parallelId })
      return undefined
    }

    // Extract branch index from node ID
    const branchIndex = this.extractBranchIndex(context.currentNodeId)
    if (branchIndex === null) {
      logger.debug('Node ID does not have branch index', { nodeId: context.currentNodeId })
      return undefined
    }

    // Get distribution items
    const distributionItems = this.getDistributionItems(parallelConfig)

    // Resolve parallel property
    switch (property) {
      case 'index':
        return branchIndex

      case 'currentItem':
        if (Array.isArray(distributionItems)) {
          return distributionItems[branchIndex]
        } else if (typeof distributionItems === 'object' && distributionItems !== null) {
          const keys = Object.keys(distributionItems)
          const key = keys[branchIndex]
          return key !== undefined ? distributionItems[key] : undefined
        }
        return undefined

      case 'items':
        return distributionItems

      default:
        logger.warn('Unknown parallel property', { property })
        return undefined
    }
  }

  /**
   * PRIVATE METHODS
   */

  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE_START) && value.endsWith(REFERENCE_END)
  }

  private extractContent(reference: string): string {
    return reference.substring(REFERENCE_START.length, reference.length - REFERENCE_END.length)
  }

  private findParallelForBlock(blockId: string): string | undefined {
    const baseId = this.extractBaseId(blockId)

    if (!this.workflow.parallels) {
      return undefined
    }

    for (const parallelId of Object.keys(this.workflow.parallels)) {
      const parallelConfig = this.workflow.parallels[parallelId]
      if (parallelConfig?.nodes.includes(baseId)) {
        return parallelId
      }
    }

    return undefined
  }

  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }

  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? parseInt(match[1], 10) : null
  }

  private getDistributionItems(parallelConfig: any): any {
    let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []

    // Parse if string
    if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
      try {
        distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
      } catch (e) {
        logger.error('Failed to parse distribution items', { distributionItems })
        return []
      }
    }

    return distributionItems
  }
}

