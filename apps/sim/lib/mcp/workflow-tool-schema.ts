import type { InputFormatField } from '@/lib/workflows/types'

/**
 * MCP Tool Schema following the JSON Schema specification
 */
export interface McpToolInputSchema {
  type: 'object'
  properties: Record<string, McpToolProperty>
  required?: string[]
}

export interface McpToolProperty {
  type: string
  description?: string
  items?: McpToolProperty
  properties?: Record<string, McpToolProperty>
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: McpToolInputSchema
}

/**
 * Map InputFormatField type to JSON Schema type
 */
function mapFieldTypeToJsonSchemaType(fieldType: string | undefined): string {
  switch (fieldType) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    case 'array':
      return 'array'
    case 'files':
      return 'array'
    default:
      return 'string'
  }
}

/**
 * Sanitize a workflow name to be a valid MCP tool name.
 * Tool names should be lowercase, alphanumeric with underscores.
 */
export function sanitizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 64) || 'workflow_tool'
}

/**
 * Generate MCP tool input schema from InputFormatField array.
 * This converts the workflow's input format definition to JSON Schema format
 * that MCP clients can use to understand tool parameters.
 */
export function generateToolInputSchema(inputFormat: InputFormatField[]): McpToolInputSchema {
  const properties: Record<string, McpToolProperty> = {}
  const required: string[] = []

  for (const field of inputFormat) {
    if (!field.name) continue

    const fieldName = field.name
    const fieldType = mapFieldTypeToJsonSchemaType(field.type)

    const property: McpToolProperty = {
      type: fieldType,
      description: fieldName, // Use field name as description by default
    }

    // Handle array types
    if (fieldType === 'array') {
      if (field.type === 'files') {
        property.items = {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            url: { type: 'string', description: 'File URL' },
            type: { type: 'string', description: 'MIME type' },
            size: { type: 'number', description: 'File size in bytes' },
          },
        }
        property.description = 'Array of file objects'
      } else {
        property.items = { type: 'string' }
      }
    }

    properties[fieldName] = property

    // All fields are considered required by default
    // (in the future, we could add an optional flag to InputFormatField)
    required.push(fieldName)
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  }
}

/**
 * Generate a complete MCP tool definition from workflow metadata and input format.
 */
export function generateToolDefinition(
  workflowName: string,
  workflowDescription: string | undefined | null,
  inputFormat: InputFormatField[],
  customToolName?: string,
  customDescription?: string
): McpToolDefinition {
  return {
    name: customToolName || sanitizeToolName(workflowName),
    description: customDescription || workflowDescription || `Execute ${workflowName} workflow`,
    inputSchema: generateToolInputSchema(inputFormat),
  }
}

/**
 * Extract input format from a workflow's blocks.
 * Looks for the starter block and extracts its inputFormat configuration.
 */
export function extractInputFormatFromBlocks(
  blocks: Record<string, unknown>
): InputFormatField[] | null {
  // Look for starter or input_trigger block
  for (const [, block] of Object.entries(blocks)) {
    if (!block || typeof block !== 'object') continue

    const blockObj = block as Record<string, unknown>
    const blockType = blockObj.type

    if (blockType === 'starter' || blockType === 'input_trigger') {
      // Try to get inputFormat from subBlocks
      const subBlocks = blockObj.subBlocks as Record<string, unknown> | undefined
      if (subBlocks?.inputFormat) {
        const inputFormatSubBlock = subBlocks.inputFormat as Record<string, unknown>
        const value = inputFormatSubBlock.value
        if (Array.isArray(value)) {
          return value as InputFormatField[]
        }
      }

      // Try legacy config.params.inputFormat
      const config = blockObj.config as Record<string, unknown> | undefined
      const params = config?.params as Record<string, unknown> | undefined
      if (params?.inputFormat && Array.isArray(params.inputFormat)) {
        return params.inputFormat as InputFormatField[]
      }
    }
  }

  return null
}
