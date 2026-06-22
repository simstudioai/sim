import { z } from 'zod'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import type { McpToolSchema } from './types'

/**
 * Extended property definition for workflow tool schemas.
 * More specific than the generic McpToolSchema properties.
 */
export interface McpToolProperty {
  [key: string]: unknown
  type: string
  description?: string
  items?: McpToolProperty
  properties?: Record<string, McpToolProperty>
}

/**
 * Extended MCP tool schema with typed properties (for workflow tool generation).
 * Extends the base McpToolSchema with more specific property types.
 */
export interface McpToolInputSchema extends McpToolSchema {
  properties: Record<string, McpToolProperty>
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: McpToolInputSchema
}

/**
 * File item Zod schema for MCP file inputs.
 * This is the single source of truth for file structure.
 */
export const fileItemZodSchema = z.object({
  name: z.string().describe('File name'),
  data: z.string().describe('Base64 encoded file content'),
  mimeType: z.string().describe('MIME type of the file'),
})

/**
 * Convert InputFormatField type to Zod schema
 */
function fieldTypeToZod(fieldType: string | undefined, isRequired: boolean): z.ZodTypeAny {
  let zodType: z.ZodTypeAny

  switch (fieldType) {
    case 'string':
      zodType = z.string()
      break
    case 'number':
      zodType = z.number()
      break
    case 'boolean':
      zodType = z.boolean()
      break
    case 'object':
      zodType = z.record(z.string(), z.any())
      break
    case 'array':
      zodType = z.array(z.any())
      break
    case 'files':
      zodType = z.array(fileItemZodSchema)
      break
    default:
      zodType = z.string()
  }

  return isRequired ? zodType : zodType.optional()
}

/**
 * Generate Zod schema shape from InputFormatField array.
 * This is used directly by the MCP server for tool registration.
 */
export function generateToolZodSchema(inputFormat: InputFormatField[]): z.ZodRawShape | undefined {
  if (!inputFormat || inputFormat.length === 0) {
    return undefined
  }

  const shape: Record<string, z.ZodTypeAny> = {}

  for (const field of inputFormat) {
    if (!field.name) continue

    const zodType = fieldTypeToZod(field.type, true)
    shape[field.name] = field.name ? zodType.describe(field.name) : zodType
  }

  return Object.keys(shape).length > 0 ? shape : undefined
}

/**
 * Map InputFormatField type to JSON Schema type (for database storage)
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
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 64) || 'workflow_tool'
  )
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
      // Use custom description if provided, otherwise use field name
      description: field.description?.trim() || fieldName,
    }

    // Handle array types
    if (fieldType === 'array') {
      if (field.type === 'file[]') {
        property.items = {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            url: { type: 'string', description: 'File URL' },
            type: { type: 'string', description: 'MIME type' },
            size: { type: 'number', description: 'File size in bytes' },
          },
        }
        // Use custom description if provided, otherwise use default
        if (!field.description?.trim()) {
          property.description = 'Array of file objects'
        }
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
 * Overlay sparse per-parameter description overrides onto a base schema produced by
 * `generateToolInputSchema`. Only keys present in both `overrides` and the base are applied;
 * overrides for fields no longer in the Start block are ignored. An empty override falls back to
 * the field name, matching the base converter's "no description" behavior.
 */
export function applyDescriptionOverrides(
  baseSchema: Record<string, unknown>,
  overrides: Record<string, string> | null | undefined
): Record<string, unknown> {
  if (!overrides || Object.keys(overrides).length === 0) return baseSchema
  const baseProperties = baseSchema.properties as Record<string, McpToolProperty> | undefined
  if (!baseProperties) return baseSchema

  const properties: Record<string, McpToolProperty> = {}
  for (const [name, property] of Object.entries(baseProperties)) {
    const override = overrides[name]
    properties[name] =
      typeof override === 'string'
        ? { ...property, description: override.trim() || name }
        : property
  }

  return { ...baseSchema, properties }
}

/**
 * Drop override entries whose parameter no longer exists in the base schema, so the stored override
 * map never accumulates or resurrects descriptions for removed Start-block inputs.
 */
export function pruneOverridesToSchema(
  overrides: Record<string, string>,
  baseSchema: Record<string, unknown>
): Record<string, string> {
  const baseProperties = (baseSchema.properties ?? {}) as Record<string, unknown>
  const pruned: Record<string, string> = {}
  for (const [name, value] of Object.entries(overrides)) {
    if (name in baseProperties) pruned[name] = value
  }
  return pruned
}

/**
 * Derive the sparse description-override map between a full schema and the Start-block base: keep
 * only fields whose description is a real custom value (present, not equal to the field name, and
 * different from the base). Used to migrate a legacy full `parameterSchema` payload into overrides
 * during the transition window.
 */
export function extractDescriptionOverrides(
  schema: Record<string, unknown> | null | undefined,
  baseSchema: Record<string, unknown>
): Record<string, string> {
  const overrides: Record<string, string> = {}
  const schemaProperties = schema?.properties as
    | Record<string, { description?: unknown }>
    | undefined
  if (!schemaProperties) return overrides
  const baseProperties = (baseSchema.properties ?? {}) as Record<string, McpToolProperty>

  for (const [name, property] of Object.entries(schemaProperties)) {
    if (!(name in baseProperties)) continue
    const description = typeof property?.description === 'string' ? property.description.trim() : ''
    if (!description || description === name) continue
    const baseDescription =
      typeof baseProperties[name]?.description === 'string'
        ? (baseProperties[name].description as string)
        : ''
    if (description !== baseDescription) overrides[name] = description
  }

  return overrides
}

const DEFAULT_WORKFLOW_DESCRIPTIONS = new Set([
  'new workflow',
  'your first workflow - start building here!',
])

/**
 * Returns the workflow description when it is a real, user-meaningful value, or `null` for empty or
 * placeholder defaults (so callers can fall back to a derived description). Shared by the serve
 * layer and the deploy UI so both treat the same values as "no description".
 */
export function getMeaningfulWorkflowDescription(
  description: string | null | undefined,
  workflowName?: string | null
): string | null {
  const trimmed = description?.trim()
  if (!trimmed) return null
  if (DEFAULT_WORKFLOW_DESCRIPTIONS.has(trimmed.toLowerCase())) return null
  if (workflowName && trimmed === workflowName.trim()) return null
  return trimmed
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
 * Looks for any valid start block and extracts its inputFormat configuration.
 */
export function extractInputFormatFromBlocks(
  blocks: Record<string, unknown>
): InputFormatField[] | null {
  // Look for any valid start block
  for (const [, block] of Object.entries(blocks)) {
    if (!block || typeof block !== 'object') continue

    const blockObj = block as Record<string, unknown>
    const blockType = blockObj.type as string

    if (isInputDefinitionTrigger(blockType)) {
      // Try to get inputFormat from subBlocks.inputFormat.value
      const subBlocks = blockObj.subBlocks as Record<string, { value?: unknown }> | undefined
      const subBlockValue = subBlocks?.inputFormat?.value

      // Try legacy config.params.inputFormat
      const config = blockObj.config as Record<string, unknown> | undefined
      const params = config?.params as Record<string, unknown> | undefined
      const paramsValue = params?.inputFormat

      const normalized = normalizeInputFormatValue(subBlockValue ?? paramsValue)
      return normalized.length > 0 ? normalized : null
    }
  }

  return null
}
