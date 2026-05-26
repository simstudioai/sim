import { createLogger } from '@sim/logger'
import { assertNoLargeValueRefs } from '@/lib/execution/payloads/large-value-ref'
import { isReference, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import {
  extractInnermostOuterBranchIndex,
  extractOuterBranchIndex,
  findEffectiveContainerId,
  isSubflowNestedInside,
  stripCloneSuffixes,
  stripOuterBranchSuffix,
  subflowContainsBlock,
} from '@/executor/utils/subflow-utils'
import {
  type AsyncPathNavigator,
  navigatePath,
  type ResolutionContext,
  type Resolver,
  splitLeadingBracketPath,
} from '@/executor/variables/resolvers/reference'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('LoopResolver')
const LOOP_OUTPUT_FIELDS = ['results'] as const
const LOOP_CONTEXT_FIELDS = ['index'] as const
const FOR_EACH_LOOP_CONTEXT_FIELDS = ['index', 'currentItem', 'items'] as const

export class LoopResolver implements Resolver {
  private loopNameToId: Map<string, string>

  constructor(
    private workflow: SerializedWorkflow,
    private navigatePathAsync?: AsyncPathNavigator
  ) {
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
    return this.resolveInternal(reference, context, false)
  }

  async resolveAsync(reference: string, context: ResolutionContext): Promise<any> {
    if (!this.navigatePathAsync) {
      return this.resolve(reference, context)
    }
    return this.resolveInternal(reference, context, true)
  }

  private async resolveInternal(
    reference: string,
    context: ResolutionContext,
    useAsyncPath: true
  ): Promise<any>
  private resolveInternal(reference: string, context: ResolutionContext, useAsyncPath: false): any
  private resolveInternal(
    reference: string,
    context: ResolutionContext,
    useAsyncPath: boolean
  ): any | Promise<any> {
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
      const mappedBranchIndex =
        (isGenericRef
          ? extractInnermostOuterBranchIndex(context.currentNodeId)
          : extractOuterBranchIndex(context.currentNodeId)) ??
        context.executionContext.parallelBlockMapping?.get(context.currentNodeId)?.iterationIndex
      targetLoopId = findEffectiveContainerId(
        targetLoopId,
        context.currentNodeId,
        context.executionContext.loopExecutions,
        mappedBranchIndex
      )
    }

    if (rest.length > 0) {
      const { property, pathParts: bracketPathParts } = splitLeadingBracketPath(rest[0])

      if (LoopResolver.OUTPUT_PROPERTIES.has(property)) {
        if (!targetLoopId) {
          return undefined
        }
        return useAsyncPath
          ? this.resolveOutputAsync(targetLoopId, [...bracketPathParts, ...rest.slice(1)], context)
          : this.resolveOutput(targetLoopId, [...bracketPathParts, ...rest.slice(1)], context)
      }

      const isContextual =
        isGenericRef ||
        (targetLoopId !== undefined &&
          this.isBlockInLoopOrDescendant(context.currentNodeId, targetLoopId))

      if (!LoopResolver.KNOWN_PROPERTIES.has(property)) {
        throw new InvalidFieldError(
          firstPart,
          rest[0],
          this.getAvailableFields(targetLoopId, context)
        )
      }

      if (!isContextual) {
        throw new InvalidFieldError(firstPart, rest[0], [...LOOP_OUTPUT_FIELDS])
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

    const [rawProperty, ...remainingPathParts] = rest
    const { property, pathParts: bracketPathParts } = splitLeadingBracketPath(rawProperty)
    const pathParts = [...bracketPathParts, ...remainingPathParts]

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
      return useAsyncPath && this.navigatePathAsync
        ? this.navigatePathAsync(value, pathParts, context)
        : navigatePath(value, pathParts, {
            allowLargeValueRefs: context.allowLargeValueRefs,
            executionContext: context.executionContext,
          })
    }

    return value
  }

  private resolveOutput(loopId: string, pathParts: string[], context: ResolutionContext): unknown {
    const output = context.executionState.getBlockOutput(loopId)
    if (!output || typeof output !== 'object') {
      return undefined
    }
    const value = navigatePath(output, ['results'], {
      allowLargeValueRefs: true,
      executionContext: context.executionContext,
    })
    if (pathParts.length > 0) {
      return navigatePath(value, pathParts, {
        allowLargeValueRefs: context.allowLargeValueRefs,
        executionContext: context.executionContext,
      })
    }
    if (!context.allowLargeValueRefs) {
      assertNoLargeValueRefs(value)
    }
    return value
  }

  private async resolveOutputAsync(
    loopId: string,
    pathParts: string[],
    context: ResolutionContext
  ): Promise<unknown> {
    const output = context.executionState.getBlockOutput(loopId)
    if (!output || typeof output !== 'object') {
      return undefined
    }
    const value = this.navigatePathAsync
      ? await this.navigatePathAsync(output, ['results'], { ...context, allowLargeValueRefs: true })
      : navigatePath(output, ['results'], {
          allowLargeValueRefs: true,
          executionContext: context.executionContext,
        })
    if (pathParts.length > 0) {
      return this.navigatePathAsync
        ? this.navigatePathAsync(value, pathParts, context)
        : navigatePath(value, pathParts, {
            allowLargeValueRefs: context.allowLargeValueRefs,
            executionContext: context.executionContext,
          })
    }
    if (!context.allowLargeValueRefs) {
      assertNoLargeValueRefs(value)
    }
    return value
  }

  private findInnermostLoopForBlock(blockId: string): string | undefined {
    const baseId = stripCloneSuffixes(blockId)
    const loops = this.workflow.loops || {}
    const candidateLoopIds = Object.keys(loops).filter((loopId) =>
      subflowContainsBlock(this.workflow, 'loop', loopId, baseId)
    )
    if (candidateLoopIds.length === 0) return undefined
    if (candidateLoopIds.length === 1) return candidateLoopIds[0]

    // Return the innermost: the loop that is not an ancestor of any other candidate.
    // In a valid DAG, exactly one candidate will satisfy this (circular containment is impossible).
    return candidateLoopIds.find((candidateId) =>
      candidateLoopIds.every(
        (otherId) =>
          otherId === candidateId ||
          !isSubflowNestedInside(this.workflow, 'loop', otherId, 'loop', candidateId)
      )
    )
  }

  private isBlockInLoopOrDescendant(blockId: string, targetLoopId: string): boolean {
    const baseId = stripCloneSuffixes(blockId)
    const originalLoopId = stripOuterBranchSuffix(targetLoopId)
    return subflowContainsBlock(this.workflow, 'loop', originalLoopId, baseId)
  }

  private isForEachLoop(loopId: string): boolean {
    const originalId = stripOuterBranchSuffix(loopId)
    const loopConfig = this.workflow.loops?.[originalId]
    return loopConfig?.loopType === 'forEach'
  }

  private getAvailableFields(
    targetLoopId: string | undefined,
    context: ResolutionContext
  ): string[] {
    const isContextual =
      targetLoopId === undefined ||
      this.isBlockInLoopOrDescendant(context.currentNodeId, targetLoopId)

    if (!isContextual) {
      return [...LOOP_OUTPUT_FIELDS]
    }

    const isForEach = targetLoopId
      ? this.isForEachLoop(targetLoopId)
      : context.loopScope?.items !== undefined
    return isForEach ? [...FOR_EACH_LOOP_CONTEXT_FIELDS] : [...LOOP_CONTEXT_FIELDS]
  }
}
