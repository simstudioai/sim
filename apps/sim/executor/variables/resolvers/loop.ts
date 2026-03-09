import { createLogger } from '@sim/logger'
import { isReference, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import {
  findEffectiveContainerId,
  stripCloneSuffixes,
  stripOuterBranchSuffix,
} from '@/executor/utils/subflow-utils'
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
  private static KNOWN_PROPERTIES = new Set(['iteration', 'index', 'item', 'currentItem', 'items'])

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

    // Resolve the effective (possibly cloned) loop ID for scope/output lookups
    if (targetLoopId && context.executionContext.loopExecutions) {
      targetLoopId = findEffectiveContainerId(
        targetLoopId,
        context.currentNodeId,
        context.executionContext.loopExecutions
      )
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
    const baseId = stripCloneSuffixes(blockId)
    const loops = this.workflow.loops || {}
    const candidateLoopIds = Object.keys(loops).filter((loopId) =>
      loops[loopId].nodes.includes(baseId)
    )
    if (candidateLoopIds.length === 0) return undefined
    if (candidateLoopIds.length === 1) return candidateLoopIds[0]

    // Return the innermost: the loop that is not an ancestor of any other candidate.
    // In a valid DAG, exactly one candidate will satisfy this (circular containment is impossible).
    return candidateLoopIds.find((candidateId) =>
      candidateLoopIds.every(
        (otherId) => otherId === candidateId || !loops[candidateId].nodes.includes(otherId)
      )
    )
  }

  private isBlockInLoopOrDescendant(blockId: string, targetLoopId: string): boolean {
    const baseId = stripCloneSuffixes(blockId)
    const originalLoopId = stripOuterBranchSuffix(targetLoopId)
    const targetLoop = this.workflow.loops?.[originalLoopId]
    if (!targetLoop) {
      return false
    }
    if (targetLoop.nodes.includes(baseId)) {
      return true
    }
    const directLoopId = this.findInnermostLoopForBlock(blockId)
    if (!directLoopId) {
      return false
    }
    if (directLoopId === originalLoopId) {
      return true
    }
    return this.isLoopNestedInside(directLoopId, originalLoopId)
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
    const originalId = stripOuterBranchSuffix(loopId)
    const loopConfig = this.workflow.loops?.[originalId]
    return loopConfig?.loopType === 'forEach'
  }
}
