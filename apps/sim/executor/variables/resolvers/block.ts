import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import {
  isReference,
  normalizeName,
  parseReferencePath,
  SPECIAL_REFERENCE_PREFIXES,
} from '@/executor/constants'
import {
  InvalidFieldError,
  type OutputSchema,
  resolveBlockReference,
} from '@/executor/utils/block-reference'
import {
  navigatePath,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { getTool } from '@/tools/utils'

export class BlockResolver implements Resolver {
  private nameToBlockId: Map<string, string>
  private blockById: Map<string, SerializedBlock>

  constructor(private workflow: SerializedWorkflow) {
    this.nameToBlockId = new Map()
    this.blockById = new Map()
    for (const block of workflow.blocks) {
      this.blockById.set(block.id, block)
      if (block.metadata?.name) {
        this.nameToBlockId.set(normalizeName(block.metadata.name), block.id)
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

    const blockType = block.metadata?.id
    const params = block.config?.params as Record<string, unknown> | undefined
    const subBlocks = params
      ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { value: v }]))
      : undefined
    const toolId = block.config?.tool
    const toolConfig = toolId ? getTool(toolId) : undefined
    const outputSchema =
      toolConfig?.outputs ?? (blockType ? getBlockOutputs(blockType, subBlocks) : block.outputs)

    if (outputSchema && Object.keys(outputSchema).length > 0) {
      blockOutputSchemas[blockId] = outputSchema
    }

    try {
      const result = resolveBlockReference(blockName, pathParts, {
        blockNameMapping: Object.fromEntries(this.nameToBlockId),
        blockData,
        blockOutputSchemas,
      })!

      return result.value
    } catch (error) {
      if (error instanceof InvalidFieldError) {
        if (output !== undefined && pathParts.length > 0) {
          if (
            block.metadata?.id === 'response' &&
            pathParts[0] === 'response' &&
            output?.response === undefined
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

          const isWorkflowBlock =
            block.metadata?.id === 'workflow' || block.metadata?.id === 'workflow_input'
          if (
            isWorkflowBlock &&
            pathParts[0] === 'result' &&
            pathParts[1] === 'response' &&
            output?.result?.response === undefined
          ) {
            const adjustedPathParts = ['result', ...pathParts.slice(2)]
            const fallbackResult = navigatePath(output, adjustedPathParts)
            if (fallbackResult !== undefined) {
              return fallbackResult
            }
          }
        }
        throw new Error(error.message)
      }
      throw error
    }
  }

  private getBlockOutput(blockId: string, context: ResolutionContext): any {
    const stateOutput = context.executionState.getBlockOutput(blockId, context.currentNodeId)
    if (stateOutput !== undefined) {
      return stateOutput
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

  public formatValueForBlock(
    value: any,
    blockType: string | undefined,
    isInTemplateLiteral = false
  ): string {
    if (blockType === 'condition') {
      return this.stringifyForCondition(value)
    }

    if (blockType === 'function') {
      return this.formatValueForCodeContext(value, isInTemplateLiteral)
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

  private formatValueForCodeContext(value: any, isInTemplateLiteral: boolean): string {
    if (isInTemplateLiteral) {
      if (typeof value === 'string') {
        return value
      }
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value)
      }
      return String(value)
    }

    if (typeof value === 'string') {
      return JSON.stringify(value)
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value)
    }
    if (value === undefined) {
      return 'undefined'
    }
    if (value === null) {
      return 'null'
    }
    return String(value)
  }
}
