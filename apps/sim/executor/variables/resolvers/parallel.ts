import { createLogger } from '@/lib/logs/console/logger'
import { REFERENCE } from '@/executor/consts'
import type { SerializedWorkflow } from '@/serializer/types'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('ParallelResolver')
export class ParallelResolver implements Resolver {
  constructor(private workflow: SerializedWorkflow) {}
  canResolve(reference: string): boolean {
    if (!this.isReference(reference)) {
      return false
    }
    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return type === REFERENCE.PREFIX.PARALLEL
  }
  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)
    if (parts.length < 2) {
      logger.warn('Invalid parallel reference - missing property', { reference })
      return undefined
    }
    const [_, property] = parts
    const parallelId = this.findParallelForBlock(context.currentNodeId)
    if (!parallelId) {
      logger.debug('Block not in a parallel', { nodeId: context.currentNodeId })
      return undefined
    }
    const parallelConfig = this.workflow.parallels?.[parallelId]
    if (!parallelConfig) {
      logger.warn('Parallel config not found', { parallelId })
      return undefined
    }
    const branchIndex = this.extractBranchIndex(context.currentNodeId)
    if (branchIndex === null) {
      logger.debug('Node ID does not have branch index', { nodeId: context.currentNodeId })
      return undefined
    }
    const distributionItems = this.getDistributionItems(parallelConfig)
    switch (property) {
      case 'index':
        return branchIndex
      case 'currentItem':
        if (Array.isArray(distributionItems)) {
          return distributionItems[branchIndex]
        }
        if (typeof distributionItems === 'object' && distributionItems !== null) {
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
  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE.START) && value.endsWith(REFERENCE.END)
  }
  private extractContent(reference: string): string {
    return reference.substring(REFERENCE.START.length, reference.length - REFERENCE.END.length)
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
    return match ? Number.parseInt(match[1], 10) : null
  }
  private getDistributionItems(parallelConfig: any): any {
    let distributionItems = parallelConfig.distributionItems || parallelConfig.distribution || []
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
