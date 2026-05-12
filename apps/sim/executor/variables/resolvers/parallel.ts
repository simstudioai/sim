import { createLogger } from '@sim/logger'
import { assertNoLargeValueRefs } from '@/lib/execution/payloads/large-value-ref'
import { isReference, normalizeName, parseReferencePath, REFERENCE } from '@/executor/constants'
import { InvalidFieldError } from '@/executor/utils/block-reference'
import {
  extractBranchIndex,
  extractOuterBranchIndex,
  findEffectiveContainerId,
  stripCloneSuffixes,
  stripOuterBranchSuffix,
} from '@/executor/utils/subflow-utils'
import {
  type AsyncPathNavigator,
  navigatePath,
  type ResolutionContext,
  type Resolver,
  splitLeadingBracketPath,
} from '@/executor/variables/resolvers/reference'
import type { SerializedParallel, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('ParallelResolver')
const PARALLEL_OUTPUT_FIELDS = ['results'] as const
const PARALLEL_CONTEXT_FIELDS = ['index'] as const
const COLLECTION_PARALLEL_CONTEXT_FIELDS = ['index', 'currentItem', 'items'] as const

export class ParallelResolver implements Resolver {
  private parallelNameToId: Map<string, string>

  constructor(
    private workflow: SerializedWorkflow,
    private navigatePathAsync?: AsyncPathNavigator
  ) {
    this.parallelNameToId = new Map()
    for (const block of workflow.blocks) {
      if (workflow.parallels?.[block.id] && block.metadata?.name) {
        this.parallelNameToId.set(normalizeName(block.metadata.name), block.id)
      }
    }
  }

  private static OUTPUT_PROPERTIES = new Set(['result', 'results'])
  private static KNOWN_PROPERTIES = new Set(['index', 'currentItem', 'items'])

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return type === REFERENCE.PREFIX.PARALLEL || this.parallelNameToId.has(type)
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
      logger.warn('Invalid parallel reference', { reference })
      return undefined
    }

    const [firstPart, ...rest] = parts
    const isGenericRef = firstPart === REFERENCE.PREFIX.PARALLEL

    // For named references, resolve to the specific parallel ID
    let targetParallelId: string | undefined
    if (isGenericRef) {
      targetParallelId = this.findInnermostParallelForBlock(context.currentNodeId)
    } else {
      targetParallelId = this.parallelNameToId.get(firstPart)
    }

    if (!targetParallelId) {
      return undefined
    }

    // Resolve the effective (possibly cloned) parallel ID for scope lookups
    if (context.executionContext.parallelExecutions) {
      targetParallelId = findEffectiveContainerId(
        targetParallelId,
        context.currentNodeId,
        context.executionContext.parallelExecutions
      )
    }

    if (rest.length > 0) {
      const { property, pathParts: bracketPathParts } = splitLeadingBracketPath(rest[0])
      if (ParallelResolver.OUTPUT_PROPERTIES.has(property)) {
        return useAsyncPath
          ? this.resolveOutputAsync(
              targetParallelId,
              [...bracketPathParts, ...rest.slice(1)],
              context
            )
          : this.resolveOutput(targetParallelId, [...bracketPathParts, ...rest.slice(1)], context)
      }
    }

    // Look up config using the original (non-cloned) ID
    const originalParallelId = stripOuterBranchSuffix(targetParallelId)
    const parallelConfig = this.workflow.parallels?.[originalParallelId]
    if (!parallelConfig) {
      logger.warn('Parallel config not found', { parallelId: targetParallelId })
      return undefined
    }

    const isContextual =
      isGenericRef || this.isBlockInParallelOrDescendant(context.currentNodeId, originalParallelId)

    if (rest.length > 0 && !isContextual) {
      throw new InvalidFieldError(firstPart, rest[0], [...PARALLEL_OUTPUT_FIELDS])
    }

    const branchIndex = this.resolveBranchIndex(targetParallelId, context)
    if (branchIndex === null) {
      return undefined
    }

    const parallelScope = context.executionContext.parallelExecutions?.get(targetParallelId)
    const distributionItems = parallelScope?.items ?? this.getDistributionItems(parallelConfig)

    const currentItem = this.resolveCurrentItem(distributionItems, branchIndex)

    if (rest.length === 0) {
      const result: Record<string, any> = { index: branchIndex }
      if (distributionItems !== undefined) {
        result.items = distributionItems
        result.currentItem = currentItem
      }
      return result
    }

    const [rawProperty, ...remainingPathParts] = rest
    const { property, pathParts: bracketPathParts } = splitLeadingBracketPath(rawProperty)
    const pathParts = [...bracketPathParts, ...remainingPathParts]

    if (!ParallelResolver.KNOWN_PROPERTIES.has(property)) {
      throw new InvalidFieldError(firstPart, rawProperty, this.getAvailableFields(parallelConfig))
    }

    let value: unknown
    switch (property) {
      case 'index':
        value = branchIndex
        break
      case 'currentItem':
        value = currentItem
        if (value === undefined) return undefined
        break
      case 'items':
        value = distributionItems
        break
    }

    if (pathParts.length > 0) {
      return useAsyncPath && this.navigatePathAsync
        ? this.navigatePathAsync(value, pathParts, context)
        : navigatePath(value, pathParts, { executionContext: context.executionContext })
    }

    return value
  }

  private resolveBranchIndex(targetParallelId: string, context: ResolutionContext): number | null {
    const mapping = context.executionContext.parallelBlockMapping?.get(context.currentNodeId)
    if (mapping?.parallelId === targetParallelId) {
      return mapping.iterationIndex
    }

    const outerBranchIndex = extractOuterBranchIndex(context.currentNodeId)
    if (outerBranchIndex !== undefined) {
      return outerBranchIndex
    }

    return extractBranchIndex(context.currentNodeId)
  }

  private findInnermostParallelForBlock(blockId: string): string | undefined {
    const baseId = stripCloneSuffixes(blockId)
    const parallels = this.workflow.parallels
    if (!parallels) return undefined

    const candidateIds = Object.keys(parallels).filter((parallelId) =>
      parallels[parallelId]?.nodes.includes(baseId)
    )
    if (candidateIds.length === 0) return undefined
    if (candidateIds.length === 1) return candidateIds[0]

    // Return the innermost: the parallel that is not an ancestor of any other candidate.
    // In a valid DAG, exactly one candidate will satisfy this (circular containment is impossible).
    return candidateIds.find((candidateId) =>
      candidateIds.every(
        (otherId) => otherId === candidateId || !parallels[candidateId]?.nodes.includes(otherId)
      )
    )
  }

  private isBlockInParallelOrDescendant(blockId: string, targetParallelId: string): boolean {
    const baseId = stripCloneSuffixes(blockId)
    const parallels = this.workflow.parallels
    if (!parallels) return false

    const targetConfig = parallels[targetParallelId]
    if (!targetConfig) return false

    if (targetConfig.nodes.includes(baseId)) return true

    const directParallelId = this.findInnermostParallelForBlock(blockId)
    if (!directParallelId) return false
    if (directParallelId === targetParallelId) return true

    return this.isParallelNestedInside(directParallelId, targetParallelId)
  }

  private isParallelNestedInside(
    childParallelId: string,
    ancestorParallelId: string,
    visited = new Set<string>()
  ): boolean {
    if (visited.has(ancestorParallelId)) return false
    visited.add(ancestorParallelId)

    const ancestorConfig = this.workflow.parallels?.[ancestorParallelId]
    if (!ancestorConfig) return false

    if (ancestorConfig.nodes.includes(childParallelId)) return true

    for (const nodeId of ancestorConfig.nodes) {
      if (this.workflow.parallels?.[nodeId]) {
        if (this.isParallelNestedInside(childParallelId, nodeId, visited)) {
          return true
        }
      }
    }
    return false
  }

  private resolveCurrentItem(
    distributionItems: unknown[] | undefined,
    branchIndex: number
  ): unknown {
    if (Array.isArray(distributionItems)) {
      return distributionItems[branchIndex]
    }
    if (typeof distributionItems === 'object' && distributionItems !== null) {
      const keys = Object.keys(distributionItems)
      const key = keys[branchIndex]
      return key !== undefined ? (distributionItems as Record<string, unknown>)[key] : undefined
    }
    return undefined
  }

  private resolveOutput(
    parallelId: string,
    pathParts: string[],
    context: ResolutionContext
  ): unknown {
    const output = context.executionState.getBlockOutput(parallelId)
    if (!output || typeof output !== 'object') {
      return undefined
    }
    const value = (output as Record<string, unknown>).results
    if (pathParts.length > 0) {
      return navigatePath(value, pathParts, { executionContext: context.executionContext })
    }
    if (!context.allowLargeValueRefs) {
      assertNoLargeValueRefs(value)
    }
    return value
  }

  private async resolveOutputAsync(
    parallelId: string,
    pathParts: string[],
    context: ResolutionContext
  ): Promise<unknown> {
    const output = context.executionState.getBlockOutput(parallelId)
    if (!output || typeof output !== 'object') {
      return undefined
    }
    const value = (output as Record<string, unknown>).results
    if (pathParts.length > 0) {
      return this.navigatePathAsync
        ? this.navigatePathAsync(value, pathParts, context)
        : navigatePath(value, pathParts, { executionContext: context.executionContext })
    }
    if (!context.allowLargeValueRefs) {
      assertNoLargeValueRefs(value)
    }
    return value
  }

  private getDistributionItems(parallelConfig: SerializedParallel): unknown[] {
    const rawItems = parallelConfig.distribution ?? []

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

  private getAvailableFields(parallelConfig: SerializedParallel): string[] {
    return parallelConfig.parallelType === 'collection'
      ? [...COLLECTION_PARALLEL_CONTEXT_FIELDS]
      : [...PARALLEL_CONTEXT_FIELDS]
  }
}
