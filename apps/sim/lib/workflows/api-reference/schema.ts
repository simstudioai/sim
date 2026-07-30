import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
} from '@/lib/core/utils/response-format'
import type { JsonSchemaNode } from '@/lib/workflows/api-reference/types'
import { extractInputFieldsFromBlocks, type WorkflowInputField } from '@/lib/workflows/input-format'

/** A provider-authored prose overlay entry, keyed by a Start field's id (or name). */
export interface FieldOverlayEntry {
  id: string
  description?: string
  example?: string
  required?: boolean
}

/**
 * Maps a workflow input-field type to a JSON Schema node. `file[]` becomes an array
 * of file descriptors — the same run-ready shape the executor accepts — so a caller
 * knows to send uploaded-file objects, not raw bytes.
 */
function inputFieldTypeToSchema(type: string): JsonSchemaNode {
  switch (type) {
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object':
      return { type: 'object' }
    case 'array':
      return { type: 'array', items: { type: 'string' } }
    case 'file[]':
      return {
        type: 'array',
        description: 'Uploaded files',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string' },
            size: { type: 'number' },
            type: { type: 'string' },
          },
        },
      }
    default:
      return { type: 'string' }
  }
}

/**
 * The request JSON Schema a caller sends. Structure comes live from the deployed
 * Start block's input fields; the overlay only layers prose/examples/required onto
 * fields that already exist — an overlay entry whose field is absent is ignored
 * (it can never invent a field). Overlay entries are keyed by `field.id ?? field.name`,
 * matching how custom blocks key their per-input overrides.
 */
export function deriveInputSchema(
  blocks: Record<string, unknown> | null | undefined,
  overlay?: FieldOverlayEntry[] | null
): JsonSchemaNode {
  const fields = extractInputFieldsFromBlocks(blocks)
  const overlayById = new Map((overlay ?? []).map((entry) => [entry.id, entry]))

  const properties: Record<string, JsonSchemaNode> = {}
  const required: string[] = []

  for (const field of fields) {
    const node = inputFieldTypeToSchema(field.type)
    const override = overlayById.get(field.id ?? field.name)
    const description = override?.description ?? field.description
    if (description) node.description = description
    if (override?.example !== undefined) node.example = override.example
    properties[field.name] = node
    if (override?.required) required.push(field.name)
  }

  const schema: JsonSchemaNode = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

/** The field names an input schema exposes (order-independent), for diffing. */
export function inputFieldSummaries(
  blocks: Record<string, unknown> | null | undefined
): WorkflowInputField[] {
  return extractInputFieldsFromBlocks(blocks)
}

const RESPONSE_BLOCK_TYPE = 'response'

/** Reads the `type` off a raw deployed block state, tolerating unknown shapes. */
function blockType(block: unknown): string | undefined {
  if (!block || typeof block !== 'object') return undefined
  const t = (block as { type?: unknown }).type
  return typeof t === 'string' ? t : undefined
}

/**
 * The response JSON Schema a caller receives. Derived from the deployed Response
 * block's structured `builderData` (a response-format schema, parsed the same way
 * the editor/agent path parses `responseFormat`). When the workflow has no Response
 * block, or the block is in free-form JSON mode, the concrete shape can't be
 * statically known — we emit a permissive object and say so, rather than lie.
 */
export function deriveOutputSchema(
  blocks: Record<string, unknown> | null | undefined
): JsonSchemaNode {
  if (!blocks) {
    return { type: 'object', description: 'No deployed workflow state' }
  }

  const responseEntry = Object.values(blocks).find(
    (block) => blockType(block) === RESPONSE_BLOCK_TYPE
  ) as { subBlocks?: Record<string, { value?: unknown }> } | undefined

  if (!responseEntry) {
    return {
      type: 'object',
      description: 'Workflow has no Response block; the raw execution result is returned.',
    }
  }

  const subBlocks = responseEntry.subBlocks ?? {}
  const dataMode = subBlocks.dataMode?.value
  const builderData = subBlocks.builderData?.value

  if (dataMode === 'json' || !builderData) {
    return {
      type: 'object',
      description: 'Response body is defined in free-form JSON; structure is caller-defined.',
    }
  }

  const parsed = parseResponseFormatSafely(builderData, 'response')
  const fields = parsed ? extractFieldsFromSchema(parsed) : []
  if (fields.length === 0) {
    return { type: 'object', description: 'Structured response with no declared fields.' }
  }

  const properties: Record<string, JsonSchemaNode> = {}
  for (const field of fields) {
    const node = inputFieldTypeToSchema(field.type || 'string')
    if (field.description) node.description = field.description
    properties[field.name] = node
  }
  return { type: 'object', properties }
}
