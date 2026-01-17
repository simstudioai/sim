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
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * Check if a path exists in an output schema.
 * Handles nested objects, arrays, and various schema formats.
 * Numeric indices (array access) are skipped during validation.
 */
function isPathInOutputSchema(
  outputs: Record<string, any> | undefined,
  pathParts: string[]
): boolean {
  if (!outputs || pathParts.length === 0) {
    return true // No schema or no path = allow (lenient)
  }

  let current: any = outputs
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i]

    // Skip numeric indices (array access like items.0.name)
    if (/^\d+$/.test(part)) {
      continue
    }

    if (current === null || current === undefined) {
      return false
    }

    // Check if the key exists directly
    if (part in current) {
      current = current[part]
      continue
    }

    // Check if current has 'properties' (object type with nested schema)
    if (current.properties && part in current.properties) {
      current = current.properties[part]
      continue
    }

    // Check if current is an array type with items
    if (current.type === 'array' && current.items) {
      // Array items can have properties or be a nested schema
      if (current.items.properties && part in current.items.properties) {
        current = current.items.properties[part]
        continue
      }
      if (part in current.items) {
        current = current.items[part]
        continue
      }
    }

    // Check if current has a 'type' field (it's a leaf with type definition)
    // but we're trying to go deeper - this means the path doesn't exist
    if ('type' in current && typeof current.type === 'string') {
      // It's a typed field, can't go deeper unless it has properties
      if (!current.properties && !current.items) {
        return false
      }
    }

    // Path part not found in schema
    return false
  }

  return true
}

/**
 * Get available top-level field names from an output schema for error messages.
 */
function getSchemaFieldNames(outputs: Record<string, any> | undefined): string[] {
  if (!outputs) return []
  return Object.keys(outputs)
}

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

    const block = this.blockById.get(blockId)
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

    // Path not found in data - check if it exists in the schema
    // If path is NOT in schema, it's likely a typo - throw an error
    // If path IS in schema but data is missing, it's an optional field - return undefined
    const schemaFields = getSchemaFieldNames(block?.outputs)
    if (schemaFields.length > 0 && !isPathInOutputSchema(block?.outputs, pathParts)) {
      throw new Error(
        `"${pathParts.join('.')}" doesn't exist on block "${blockName}". ` +
          `Available fields: ${schemaFields.join(', ')}`
      )
    }

    // Path exists in schema but data is missing - return undefined (optional field)
    return undefined
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
