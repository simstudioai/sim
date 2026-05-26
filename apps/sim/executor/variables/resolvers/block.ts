import { assertNoLargeValueRefs } from '@/lib/execution/payloads/large-value-ref'
import {
  isReference,
  normalizeName,
  parseReferencePath,
  SPECIAL_REFERENCE_PREFIXES,
} from '@/executor/constants'
import { getBlockSchema } from '@/executor/utils/block-data'
import {
  InvalidFieldError,
  type OutputSchema,
  resolveBlockReference,
  resolveBlockReferenceAsync,
} from '@/executor/utils/block-reference'
import { formatLiteralForCode } from '@/executor/utils/code-formatting'
import { buildClonedSubflowId, extractOuterBranchIndex } from '@/executor/utils/subflow-utils'
import {
  type AsyncPathNavigator,
  navigatePath,
  RESOLVED_EMPTY,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

export class BlockResolver implements Resolver {
  private nameToBlockId: Map<string, string>
  private blockById: Map<string, SerializedBlock>
  private blockIdsInSubflows: Set<string>
  private subflowContainerIds: Set<string>

  constructor(
    private workflow: SerializedWorkflow,
    private navigatePathAsync?: AsyncPathNavigator
  ) {
    this.nameToBlockId = new Map()
    this.blockById = new Map()
    this.blockIdsInSubflows = new Set()
    this.subflowContainerIds = new Set([
      ...Object.keys(workflow.loops ?? {}),
      ...Object.keys(workflow.parallels ?? {}),
    ])
    for (const block of workflow.blocks) {
      this.blockById.set(block.id, block)
      if (block.metadata?.name) {
        this.nameToBlockId.set(normalizeName(block.metadata.name), block.id)
      }
    }
    for (const loop of Object.values(workflow.loops ?? {})) {
      for (const blockId of loop.nodes ?? []) {
        this.blockIdsInSubflows.add(blockId)
      }
    }
    for (const parallel of Object.values(workflow.parallels ?? {})) {
      for (const blockId of parallel.nodes ?? []) {
        this.blockIdsInSubflows.add(blockId)
      }
    }
  }

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return !(SPECIAL_REFERENCE_PREFIXES as readonly string[]).includes(type)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return undefined
    }
    const [blockName, ...pathParts] = parts

    const blockId = this.findBlockIdByName(blockName)
    if (!blockId) {
      return undefined
    }

    const block = this.blockById.get(blockId)!
    const output = this.getBlockOutput(blockId, context)

    const blockData: Record<string, unknown> = {}
    const blockOutputSchemas: Record<string, OutputSchema> = {}

    if (output !== undefined) {
      blockData[blockId] = output
    }

    const outputSchema = getBlockSchema(block)

    if (outputSchema && Object.keys(outputSchema).length > 0) {
      blockOutputSchemas[blockId] = outputSchema
    }

    try {
      const result = resolveBlockReference(
        blockName,
        pathParts,
        {
          blockNameMapping: Object.fromEntries(this.nameToBlockId),
          blockData,
          blockOutputSchemas,
        },
        {
          allowLargeValueRefs: context.allowLargeValueRefs,
          executionContext: context.executionContext,
        }
      )!

      if (result.value !== undefined) {
        if (!context.allowLargeValueRefs) {
          assertNoLargeValueRefs(result.value)
        }
        return result.value
      }

      const backwardsCompat = this.handleBackwardsCompatSync(block, output, pathParts)
      if (backwardsCompat !== undefined) {
        return backwardsCompat
      }

      return RESOLVED_EMPTY
    } catch (error) {
      if (error instanceof InvalidFieldError) {
        const fallback = this.handleBackwardsCompatSync(block, output, pathParts)
        if (fallback !== undefined) {
          return fallback
        }
      }
      throw error
    }
  }

  async resolveAsync(reference: string, context: ResolutionContext): Promise<any> {
    if (!this.navigatePathAsync) {
      return this.resolve(reference, context)
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return undefined
    }
    const [blockName, ...pathParts] = parts

    const blockId = this.findBlockIdByName(blockName)
    if (!blockId) {
      return undefined
    }

    const block = this.blockById.get(blockId)!
    const output = this.getBlockOutput(blockId, context)

    const blockData: Record<string, unknown> = {}
    const blockOutputSchemas: Record<string, OutputSchema> = {}

    if (output !== undefined) {
      blockData[blockId] = output
    }

    const outputSchema = getBlockSchema(block)

    if (outputSchema && Object.keys(outputSchema).length > 0) {
      blockOutputSchemas[blockId] = outputSchema
    }

    try {
      const blockReferenceContext = {
        blockNameMapping: Object.fromEntries(this.nameToBlockId),
        blockData,
        blockOutputSchemas,
      }
      const result = (await resolveBlockReferenceAsync(
        blockName,
        pathParts,
        blockReferenceContext,
        context,
        this.navigatePathAsync
      ))!

      if (result.value !== undefined) {
        if (!context.allowLargeValueRefs) {
          assertNoLargeValueRefs(result.value)
        }
        return result.value
      }

      const backwardsCompat = await this.handleBackwardsCompat(block, output, pathParts, context)
      if (backwardsCompat !== undefined) {
        return backwardsCompat
      }

      return RESOLVED_EMPTY
    } catch (error) {
      if (error instanceof InvalidFieldError) {
        const fallback = await this.handleBackwardsCompat(block, output, pathParts, context)
        if (fallback !== undefined) {
          return fallback
        }
      }
      throw error
    }
  }

  private handleBackwardsCompatSync(
    block: SerializedBlock,
    output: unknown,
    pathParts: string[]
  ): unknown {
    if (output === undefined || pathParts.length === 0) {
      return undefined
    }

    if (
      block.metadata?.id === 'response' &&
      pathParts[0] === 'response' &&
      (output as Record<string, unknown>)?.response === undefined
    ) {
      const adjustedPathParts = pathParts.slice(1)
      if (adjustedPathParts.length === 0) {
        return output
      }
      const fallbackResult = navigatePath(output, adjustedPathParts)
      if (fallbackResult !== undefined) {
        return fallbackResult
      }
    }

    const outputRecord = output as Record<string, unknown> | undefined
    if (
      (block.metadata?.id === 'workflow' || block.metadata?.id === 'workflow_input') &&
      pathParts[0] === 'result' &&
      pathParts[1] === 'response' &&
      outputRecord?.result !== undefined &&
      typeof outputRecord.result === 'object' &&
      outputRecord.result !== null &&
      (outputRecord.result as Record<string, unknown>)?.response === undefined
    ) {
      const adjustedPathParts = ['result', ...pathParts.slice(2)]
      const fallbackResult = navigatePath(output, adjustedPathParts)
      if (fallbackResult !== undefined) {
        return fallbackResult
      }
    }

    return undefined
  }

  private async handleBackwardsCompat(
    block: SerializedBlock,
    output: unknown,
    pathParts: string[],
    context: ResolutionContext
  ): Promise<unknown> {
    const navigatePathAsync = this.navigatePathAsync
    if (!navigatePathAsync) {
      return this.handleBackwardsCompatSync(block, output, pathParts)
    }

    if (output === undefined || pathParts.length === 0) {
      return undefined
    }

    if (
      block.metadata?.id === 'response' &&
      pathParts[0] === 'response' &&
      (output as Record<string, unknown>)?.response === undefined
    ) {
      const adjustedPathParts = pathParts.slice(1)
      if (adjustedPathParts.length === 0) {
        return output
      }
      const fallbackResult = await navigatePathAsync(output, adjustedPathParts, context)
      if (fallbackResult !== undefined) {
        return fallbackResult
      }
    }

    const isWorkflowBlock =
      block.metadata?.id === 'workflow' || block.metadata?.id === 'workflow_input'
    const outputRecord = output as Record<string, Record<string, unknown> | undefined>
    if (
      isWorkflowBlock &&
      pathParts[0] === 'result' &&
      pathParts[1] === 'response' &&
      outputRecord?.result?.response === undefined
    ) {
      const adjustedPathParts = ['result', ...pathParts.slice(2)]
      const fallbackResult = await navigatePathAsync(output, adjustedPathParts, context)
      if (fallbackResult !== undefined) {
        return fallbackResult
      }
    }

    return undefined
  }

  private getBlockOutput(blockId: string, context: ResolutionContext): any {
    const outerBranchIndex = extractOuterBranchIndex(context.currentNodeId)
    const mappedBranchIndex =
      outerBranchIndex ??
      context.executionContext.parallelBlockMapping?.get(context.currentNodeId)?.iterationIndex
    const shouldResolveClonedSubflowOutput =
      mappedBranchIndex !== undefined &&
      mappedBranchIndex > 0 &&
      this.subflowContainerIds.has(blockId)

    if (shouldResolveClonedSubflowOutput) {
      const clonedStateOutput = context.executionState.getBlockOutput(
        buildClonedSubflowId(blockId, mappedBranchIndex)
      )
      if (clonedStateOutput !== undefined) {
        return clonedStateOutput
      }
    }

    const stateOutput = context.executionState.getBlockOutput(blockId, context.currentNodeId)
    if (stateOutput !== undefined) {
      return stateOutput
    }

    if (
      shouldResolveClonedSubflowOutput ||
      (outerBranchIndex !== undefined && this.blockIdsInSubflows.has(blockId))
    ) {
      return undefined
    }

    const contextState = context.executionContext.blockStates?.get(blockId)
    if (contextState?.output) {
      return contextState.output
    }

    return undefined
  }

  private findBlockIdByName(name: string): string | undefined {
    return this.nameToBlockId.get(normalizeName(name))
  }

  public formatValueForBlock(value: any, blockType: string | undefined, language?: string): string {
    if (blockType === 'condition') {
      return this.stringifyForCondition(value)
    }

    if (blockType === 'function') {
      return this.formatValueForCodeContext(value, language)
    }

    if (blockType === 'response') {
      if (typeof value === 'string') {
        return value
      }
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return JSON.stringify(value)
      }
      return String(value)
    }

    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value)
    }

    return String(value)
  }

  private stringifyForCondition(value: any): string {
    if (typeof value === 'string') {
      const sanitized = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
      return `"${sanitized}"`
    }
    if (value === null) {
      return 'null'
    }
    if (value === undefined) {
      return 'undefined'
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }

  private formatValueForCodeContext(value: any, language?: string): string {
    return formatLiteralForCode(value, language === 'python' ? 'python' : 'javascript')
  }
}
