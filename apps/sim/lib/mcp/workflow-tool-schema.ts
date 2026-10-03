import { z } from 'zod'
import type { McpToolSchema, McpToolSchemaProperty } from '@/lib/mcp/types'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { generateWorkflowInputShape } from '@/lib/workflows/input-schema'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'

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
export function generateToolInputSchema(
  inputFormat: InputFormatField[]
): McpToolSchema & { properties: Record<string, McpToolSchemaProperty> } {
  const schema = z.toJSONSchema(z.object(generateWorkflowInputShape(inputFormat)), {
    target: 'draft-07',
    io: 'input',
  })
  return {
    type: 'object',
    properties: schema.properties as Record<string, McpToolSchemaProperty>,
    ...(schema.required?.length ? { required: schema.required } : {}),
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
  const baseProperties = baseSchema.properties as Record<string, McpToolSchemaProperty> | undefined
  if (!baseProperties) return baseSchema

  const properties: Record<string, McpToolSchemaProperty> = {}
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
  const baseProperties = (baseSchema.properties ?? {}) as Record<string, McpToolSchemaProperty>

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
