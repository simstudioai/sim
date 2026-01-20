import { USER_FILE_ACCESSIBLE_PROPERTIES } from '@/lib/workflows/types'
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
import { getTool } from '@/tools/utils'

function isPathInOutputSchema(
  outputs: Record<string, any> | undefined,
  pathParts: string[]
): boolean {
  if (!outputs || pathParts.length === 0) {
    return true
  }

  const isFileArrayType = (value: any): boolean =>
    value?.type === 'file[]' || value?.type === 'files'

  let current: any = outputs
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i]

    const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/)
    if (arrayMatch) {
      const [, prop] = arrayMatch
      let fieldDef: any

      if (prop in current) {
        fieldDef = current[prop]
      } else if (current.properties && prop in current.properties) {
        fieldDef = current.properties[prop]
      } else if (current.type === 'array' && current.items) {
        if (current.items.properties && prop in current.items.properties) {
          fieldDef = current.items.properties[prop]
        } else if (prop in current.items) {
          fieldDef = current.items[prop]
        }
      }

      if (!fieldDef) {
        return false
      }

      if (isFileArrayType(fieldDef)) {
        if (i + 1 < pathParts.length) {
          return USER_FILE_ACCESSIBLE_PROPERTIES.includes(pathParts[i + 1] as any)
        }
        return true
      }

      if (fieldDef.type === 'array' && fieldDef.items) {
        current = fieldDef.items
        continue
      }

      current = fieldDef
      continue
    }

    // Handle array index access (e.g., [0])
    if (/^\d+$/.test(part)) {
      // If current is file[] type, next part should be a file property
      if (isFileArrayType(current)) {
        // Check if next part is a valid file property
        if (i + 1 < pathParts.length) {
          const nextPart = pathParts[i + 1]
          return USER_FILE_ACCESSIBLE_PROPERTIES.includes(nextPart as any)
        }
        // If no next part, array index access is valid
        return true
      }
      // For other array types, continue to next iteration
      continue
    }

    if (current === null || current === undefined) {
      return false
    }

    // Check if part exists in current
    if (part in current) {
      const nextCurrent = current[part]
      // If next field is file[] type and we have more parts, check if next part is numeric
      if (nextCurrent?.type === 'file[]' && i + 1 < pathParts.length) {
        const nextPart = pathParts[i + 1]
        // If next part is numeric (array index), allow it and check the part after
        if (/^\d+$/.test(nextPart) && i + 2 < pathParts.length) {
          const propertyPart = pathParts[i + 2]
          return USER_FILE_ACCESSIBLE_PROPERTIES.includes(propertyPart as any)
        }
      }
      current = nextCurrent
      continue
    }

    if (current.properties && part in current.properties) {
      current = current.properties[part]
      continue
    }

    if (current.type === 'array' && current.items) {
      if (current.items.properties && part in current.items.properties) {
        current = current.items.properties[part]
        continue
      }
      if (part in current.items) {
        current = current.items[part]
        continue
      }
    }

    // Handle file[] type - allow access to file properties after array index
    if (isFileArrayType(current) && USER_FILE_ACCESSIBLE_PROPERTIES.includes(part as any)) {
      // Valid file property access
      return true
    }

    if ('type' in current && typeof current.type === 'string') {
      if (!current.properties && !current.items) {
        return false
      }
    }

    return false
  }

  return true
}

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

    const toolId = block?.config?.tool
    const toolConfig = toolId ? getTool(toolId) : undefined
    const outputSchema = toolConfig?.outputs ?? block?.outputs
    const schemaFields = getSchemaFieldNames(outputSchema)
    if (schemaFields.length > 0 && !isPathInOutputSchema(outputSchema, pathParts)) {
      throw new Error(
        `"${pathParts.join('.')}" doesn't exist on block "${blockName}". ` +
          `Available fields: ${schemaFields.join(', ')}`
      )
    }

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
