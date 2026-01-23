import { createLogger } from '@sim/logger'
import { isReference, parseReferencePath, REFERENCE } from '@/executor/constants'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import { extractBaseBlockId, extractBranchIndex } from '@/executor/utils/subflow-utils'
import {
  navigatePath,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('ParallelResolver')

export class ParallelResolver implements Resolver {
  constructor(private workflow: SerializedWorkflow) {}

  private static KNOWN_PROPERTIES = ['index', 'currentItem', 'items']

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return type === REFERENCE.PREFIX.PARALLEL
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      logger.warn('Invalid parallel reference', { reference })
      return undefined
    }

    const parallelId = this.findParallelForBlock(context.currentNodeId)
    if (!parallelId) {
      return undefined
    }

    const parallelConfig = this.workflow.parallels?.[parallelId]
    if (!parallelConfig) {
      logger.warn('Parallel config not found', { parallelId })
      return undefined
    }

    const branchIndex = extractBranchIndex(context.currentNodeId)
    if (branchIndex === null) {
      return undefined
    }

    const parallelScope = context.executionContext.parallelExecutions?.get(parallelId)
    const distributionItems = parallelScope?.items ?? this.getDistributionItems(parallelConfig)

    if (parts.length === 1) {
      const result: Record<string, any> = {
        index: branchIndex,
      }
      if (distributionItems !== undefined) {
        result.items = distributionItems
        if (Array.isArray(distributionItems)) {
          result.currentItem = distributionItems[branchIndex]
        } else if (typeof distributionItems === 'object' && distributionItems !== null) {
          const keys = Object.keys(distributionItems)
          const key = keys[branchIndex]
          result.currentItem = key !== undefined ? distributionItems[key] : undefined
        }
      }
      return result
    }

    const [_, property, ...pathParts] = parts
    if (!ParallelResolver.KNOWN_PROPERTIES.includes(property)) {
      const isCollection = parallelConfig.parallelType === 'collection'
      const availableFields = isCollection ? ['index', 'currentItem', 'items'] : ['index']
      throw new InvalidFieldError('parallel', property, availableFields)
    }

    let value: any
    switch (property) {
      case 'index':
        value = branchIndex
        break
      case 'currentItem':
        if (Array.isArray(distributionItems)) {
          value = distributionItems[branchIndex]
        } else if (typeof distributionItems === 'object' && distributionItems !== null) {
          const keys = Object.keys(distributionItems)
          const key = keys[branchIndex]
          value = key !== undefined ? distributionItems[key] : undefined
        } else {
          return undefined
        }
        break
      case 'items':
        value = distributionItems
        break
    }

    if (pathParts.length > 0) {
      return navigatePath(value, pathParts)
    }

    return value
  }

  private findParallelForBlock(blockId: string): string | undefined {
    const baseId = extractBaseBlockId(blockId)
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

  private getDistributionItems(parallelConfig: any): any[] {
    const rawItems = parallelConfig.distributionItems || parallelConfig.distribution || []

    // Already an array - return as-is
    if (Array.isArray(rawItems)) {
      return rawItems
    }

    // Object - convert to entries array (consistent with loop forEach behavior)
    if (typeof rawItems === 'object' && rawItems !== null) {
      return Object.entries(rawItems)
    }

    // String handling
    if (typeof rawItems === 'string') {
      // Skip references - they should be resolved by the variable resolver
      if (rawItems.startsWith(REFERENCE.START)) {
        return []
      }

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(rawItems.replace(/'/g, '"'))
        if (Array.isArray(parsed)) {
          return parsed
        }
        // Parsed to non-array (e.g. object) - convert to entries
        if (typeof parsed === 'object' && parsed !== null) {
          return Object.entries(parsed)
        }
        return []
      } catch (e) {
        logger.error('Failed to parse distribution items', { rawItems })
        return []
      }
    }

    return []
  }
}
