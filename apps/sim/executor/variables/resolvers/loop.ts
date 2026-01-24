import { createLogger } from '@sim/logger'
import { isReference, parseReferencePath, REFERENCE } from '@/executor/constants'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import { extractBaseBlockId } from '@/executor/utils/subflow-utils'
import {
  navigatePath,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('LoopResolver')

export class LoopResolver implements Resolver {
  constructor(private workflow: SerializedWorkflow) {}

  private static KNOWN_PROPERTIES = ['iteration', 'index', 'item', 'currentItem', 'items']

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
    if (parts.length === 0) {
      logger.warn('Invalid loop reference', { reference })
      return undefined
    }

    const loopId = this.findLoopForBlock(context.currentNodeId)
    let loopScope = context.loopScope

    if (!loopScope) {
      if (!loopId) {
        return undefined
      }
      loopScope = context.executionContext.loopExecutions?.get(loopId)
    }

    if (!loopScope) {
      logger.warn('Loop scope not found', { reference })
      return undefined
    }

    const isForEach = loopId ? this.isForEachLoop(loopId) : loopScope.items !== undefined

    if (parts.length === 1) {
      const result: Record<string, any> = {
        index: loopScope.iteration,
      }
      if (loopScope.item !== undefined) {
        result.currentItem = loopScope.item
      }
      if (loopScope.items !== undefined) {
        result.items = loopScope.items
      }
      return result
    }

    const [_, property, ...pathParts] = parts
    if (!LoopResolver.KNOWN_PROPERTIES.includes(property)) {
      const availableFields = isForEach ? ['index', 'currentItem', 'items'] : ['index']
      throw new InvalidFieldError('loop', property, availableFields)
    }

    let value: any
    switch (property) {
      case 'iteration':
      case 'index':
        value = loopScope.iteration
        break
      case 'item':
      case 'currentItem':
        value = loopScope.item
        break
      case 'items':
        value = loopScope.items
        break
    }

    if (pathParts.length > 0) {
      return navigatePath(value, pathParts)
    }

    return value
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

  private isForEachLoop(loopId: string): boolean {
    const loopConfig = this.workflow.loops?.[loopId]
    return loopConfig?.loopType === 'forEach'
  }
}
