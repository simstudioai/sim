/**
 * LoopReferenceResolver
 * 
 * Resolves references to loop variables: <loop.iteration>, <loop.item>, <loop.index>
 * - Extracts loop scope from context
 * - Returns current iteration number, item, or index
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedWorkflow } from '@/serializer/types'
import type { ReferenceResolver, ResolutionContext } from './reference-resolver'

const logger = createLogger('LoopReferenceResolver')

const REFERENCE_START = '<'
const REFERENCE_END = '>'
const PATH_DELIMITER = '.'
const LOOP_PREFIX = 'loop'

export class LoopReferenceResolver implements ReferenceResolver {
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
    return type === LOOP_PREFIX
  }

  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(PATH_DELIMITER)

    if (parts.length < 2) {
      logger.warn('Invalid loop reference - missing property', { reference })
      return undefined
    }

    const [_, property] = parts

    // Get loop scope from context (provided) or find by current node
    let loopScope = context.loopScope
    if (!loopScope) {
      const loopId = this.findLoopForBlock(context.currentNodeId)
      if (!loopId) {
        logger.debug('Block not in a loop', { nodeId: context.currentNodeId })
        return undefined
      }
      loopScope = context.executionState.getLoopScope(loopId)
    }

    if (!loopScope) {
      logger.warn('Loop scope not found', { reference })
      return undefined
    }

    // Resolve loop property
    switch (property) {
      case 'iteration':
      case 'index':
        return loopScope.iteration

      case 'item':
      case 'currentItem':
        return loopScope.item

      case 'items':
        return loopScope.items

      default:
        logger.warn('Unknown loop property', { property })
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

  private findLoopForBlock(blockId: string): string | undefined {
    const baseId = this.extractBaseId(blockId)

    for (const loopId of Object.keys(this.workflow.loops || {})) {
      const loopConfig = this.workflow.loops[loopId]
      if (loopConfig.nodes.includes(baseId)) {
        return loopId
      }
    }

    return undefined
  }

  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }
}

