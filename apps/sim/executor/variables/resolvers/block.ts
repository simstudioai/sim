import {
  isReference,
  normalizeName,
  parseReferencePath,
  SPECIAL_REFERENCE_PREFIXES,
} from '@/executor/constants'
import {
  navigatePath,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import type { SerializedWorkflow } from '@/serializer/types'

export class BlockResolver implements Resolver {
  private nameToBlockId: Map<string, string>

  constructor(private workflow: SerializedWorkflow) {
    this.nameToBlockId = new Map()
    for (const block of workflow.blocks) {
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
    return !SPECIAL_REFERENCE_PREFIXES.includes(type as any)
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

    const output = this.getBlockOutput(blockId, context)
    if (output === undefined) {
      return undefined
    }
    if (pathParts.length === 0) {
      return output
    }

    // Try the original path first
    let result = navigatePath(output, pathParts)

    // If successful, return it immediately
    if (result !== undefined) {
      return result
    }

    // If failed, check if we should try backwards compatibility fallback
    const block = this.workflow.blocks.find((b) => b.id === blockId)

    // Response block backwards compatibility:
    // Old: <responseBlock.response.data> -> New: <responseBlock.data>
    // Only apply fallback if:
    // 1. Block type is 'response'
    // 2. Path starts with 'response.'
    // 3. Output doesn't have a 'response' key (confirming it's the new format)
    if (
      block?.metadata?.id === 'response' &&
      pathParts[0] === 'response' &&
      output?.response === undefined
    ) {
      const adjustedPathParts = pathParts.slice(1)
      if (adjustedPathParts.length === 0) {
        return output
      }
      result = navigatePath(output, adjustedPathParts)
      if (result !== undefined) {
        return result
      }
    }

    // Workflow block backwards compatibility:
    // Old: <workflowBlock.result.response.data> -> New: <workflowBlock.result.data>
    // Only apply fallback if:
    // 1. Block type is 'workflow' or 'workflow_input'
    // 2. Path starts with 'result.response.'
    // 3. output.result.response doesn't exist (confirming child used new format)
    const isWorkflowBlock =
      block?.metadata?.id === 'workflow' || block?.metadata?.id === 'workflow_input'
    if (
      isWorkflowBlock &&
      pathParts[0] === 'result' &&
      pathParts[1] === 'response' &&
      output?.result?.response === undefined
    ) {
      const adjustedPathParts = ['result', ...pathParts.slice(2)]
      result = navigatePath(output, adjustedPathParts)
      if (result !== undefined) {
        return result
      }
    }

    // If still undefined, throw error with original path
    const availableKeys = output && typeof output === 'object' ? Object.keys(output) : []
    throw new Error(
      `No value found at path "${pathParts.join('.')}" in block "${blockName}". Available fields: ${availableKeys.join(', ')}`
    )
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

  tryParseJSON(value: any): any {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    if (trimmed.length > 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return value
      }
    }

    return value
  }
}
