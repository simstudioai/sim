import { isReference, parseReferencePath, SPECIAL_REFERENCE_PREFIXES } from '@/executor/consts'
import {
  navigatePath,
  type ResolutionContext,
  type Resolver,
} from '@/executor/variables/resolvers/reference'
import type { SerializedWorkflow } from '@/serializer/types'
import { normalizeBlockName } from '@/stores/workflows/utils'

export class BlockResolver implements Resolver {
  private blockByNormalizedName: Map<string, string>

  constructor(private workflow: SerializedWorkflow) {
    this.blockByNormalizedName = new Map()
    for (const block of workflow.blocks) {
      this.blockByNormalizedName.set(block.id, block.id)
      if (block.metadata?.name) {
        const normalized = normalizeBlockName(block.metadata.name)
        this.blockByNormalizedName.set(normalized, block.id)
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

    const result = navigatePath(output, pathParts)

    if (result === undefined) {
      const availableKeys = output && typeof output === 'object' ? Object.keys(output) : []
      throw new Error(
        `No value found at path "${pathParts.join('.')}" in block "${blockName}". Available fields: ${availableKeys.join(', ')}`
      )
    }

    return result
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
    if (this.blockByNormalizedName.has(name)) {
      return this.blockByNormalizedName.get(name)
    }
    const normalized = normalizeBlockName(name)
    return this.blockByNormalizedName.get(normalized)
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
