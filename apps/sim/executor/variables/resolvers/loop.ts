import { createLogger } from '@/lib/logs/console/logger'
import { isReference, parseReferencePath, REFERENCE } from '@/executor/consts'
import { extractBaseBlockId } from '@/executor/utils/subflow-utils'
import type { ResolutionContext, Resolver } from '@/executor/variables/resolvers/reference'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('LoopResolver')

export class LoopResolver implements Resolver {
  constructor(private workflow: SerializedWorkflow) {}

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return type === REFERENCE.PREFIX.LOOP
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length < 2) {
      logger.warn('Invalid loop reference - missing property', { reference })
      return undefined
    }

    const [_, property] = parts
    let loopScope = context.loopScope

    if (!loopScope) {
      const loopId = this.findLoopForBlock(context.currentNodeId)
      if (!loopId) {
        return undefined
      }
      loopScope = context.executionContext.loopExecutions?.get(loopId)
    }

    if (!loopScope) {
      logger.warn('Loop scope not found', { reference })
      return undefined
    }
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

  private findLoopForBlock(blockId: string): string | undefined {
    const baseId = extractBaseBlockId(blockId)
    for (const loopId of Object.keys(this.workflow.loops || {})) {
      const loopConfig = this.workflow.loops[loopId]
      if (loopConfig.nodes.includes(baseId)) {
        return loopId
      }
    }

    return undefined
  }
}
