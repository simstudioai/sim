import { createLogger } from '@/lib/logs/console/logger'
import { REFERENCE } from '@/executor/consts'
import type { SerializedWorkflow } from '@/serializer/types'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('LoopResolver')

export class LoopResolver implements Resolver {
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
    return type === REFERENCE.PREFIX.LOOP
  }

  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)
    if (parts.length < 2) {
      logger.warn('Invalid loop reference - missing property', { reference })
      return undefined
    }

    const [_, property] = parts
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

  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE.START) && value.endsWith(REFERENCE.END)
  }
  private extractContent(reference: string): string {
    return reference.substring(REFERENCE.START.length, reference.length - REFERENCE.END.length)
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
