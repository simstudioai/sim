import { createLogger } from '@sim/logger'
import { isReference, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
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
  private loopNameToId: Map<string, string>

  constructor(private workflow: SerializedWorkflow) {
    this.loopNameToId = new Map()
    for (const block of workflow.blocks) {
      if (workflow.loops[block.id] && block.metadata?.name) {
        this.loopNameToId.set(normalizeName(block.metadata.name), block.id)
      }
    }
  }

  private static OUTPUT_PROPERTIES = new Set(['result', 'results'])
  private static KNOWN_PROPERTIES = new Set([
    'iteration',
    'index',
    'item',
    'currentItem',
    'items',
    'result',
    'results',
  ])

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return type === REFERENCE.PREFIX.LOOP || this.loopNameToId.has(type)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      logger.warn('Invalid loop reference', { reference })
      return undefined
    }

    const [firstPart, ...rest] = parts
    const isGenericRef = firstPart === REFERENCE.PREFIX.LOOP

    let targetLoopId: string | undefined

    if (isGenericRef) {
      targetLoopId = this.findInnermostLoopForBlock(context.currentNodeId)
      if (!targetLoopId && !context.loopScope) {
        return undefined
      }
    } else {
      targetLoopId = this.loopNameToId.get(firstPart)
      if (!targetLoopId) {
        return undefined
      }
    }

    if (rest.length > 0) {
      const property = rest[0]

      if (LoopResolver.OUTPUT_PROPERTIES.has(property)) {
        if (!targetLoopId) {
          return undefined
        }
        return this.resolveOutput(targetLoopId, rest.slice(1), context)
      }

      if (!LoopResolver.KNOWN_PROPERTIES.has(property)) {
        const isForEach = targetLoopId
          ? this.isForEachLoop(targetLoopId)
          : context.loopScope?.items !== undefined
        const availableFields = isForEach
          ? ['index', 'currentItem', 'items', 'result']
          : ['index', 'result']
        throw new InvalidFieldError(firstPart, property, availableFields)
      }

      if (!isGenericRef && targetLoopId) {
        if (!this.isBlockInLoopOrDescendant(context.currentNodeId, targetLoopId)) {
          logger.warn('Block is not inside the referenced loop', {
            reference,
            blockId: context.currentNodeId,
            loopId: targetLoopId,
          })
          return undefined
        }
      }
    }

    let loopScope = isGenericRef ? context.loopScope : undefined
    if (!loopScope && targetLoopId) {
      loopScope = context.executionContext.loopExecutions?.get(targetLoopId)
    }

    if (!loopScope) {
      logger.warn('Loop scope not found', { reference })
      return undefined
    }

    if (rest.length === 0) {
      const obj: Record<string, any> = {
        index: loopScope.iteration,
      }
      if (loopScope.item !== undefined) {
        obj.currentItem = loopScope.item
      }
      if (loopScope.items !== undefined) {
        obj.items = loopScope.items
      }
      return obj
    }

    const [property, ...pathParts] = rest

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

  private resolveOutput(loopId: string, pathParts: string[], context: ResolutionContext): unknown {
    const output = context.executionState.getBlockOutput(loopId)
    if (!output || typeof output !== 'object') {
      return undefined
    }
    const value = (output as Record<string, unknown>).results
    if (pathParts.length > 0) {
      return navigatePath(value, pathParts)
    }
    return value
  }

  private findInnermostLoopForBlock(blockId: string): string | undefined {
    const baseId = extractBaseBlockId(blockId)
    for (const loopId of Object.keys(this.workflow.loops || {})) {
      const loopConfig = this.workflow.loops[loopId]
      if (loopConfig.nodes.includes(baseId)) {
        return loopId
      }
    }
    return undefined
  }

  private isBlockInLoopOrDescendant(blockId: string, targetLoopId: string): boolean {
    const baseId = extractBaseBlockId(blockId)
    const targetLoop = this.workflow.loops?.[targetLoopId]
    if (!targetLoop) {
      return false
    }
    if (targetLoop.nodes.includes(baseId)) {
      return true
    }
    const directLoopId = this.findInnermostLoopForBlock(blockId)
    if (!directLoopId || directLoopId === targetLoopId) {
      return false
    }
    return this.isLoopNestedInside(directLoopId, targetLoopId)
  }

  private isLoopNestedInside(
    childLoopId: string,
    ancestorLoopId: string,
    visited = new Set<string>()
  ): boolean {
    if (visited.has(ancestorLoopId)) return false
    visited.add(ancestorLoopId)

    const ancestorLoop = this.workflow.loops?.[ancestorLoopId]
    if (!ancestorLoop) {
      return false
    }
    if (ancestorLoop.nodes.includes(childLoopId)) {
      return true
    }
    for (const nodeId of ancestorLoop.nodes) {
      if (this.workflow.loops[nodeId]) {
        if (this.isLoopNestedInside(childLoopId, nodeId, visited)) {
          return true
        }
      }
    }
    return false
  }

  private isForEachLoop(loopId: string): boolean {
    const loopConfig = this.workflow.loops?.[loopId]
    return loopConfig?.loopType === 'forEach'
  }
}
