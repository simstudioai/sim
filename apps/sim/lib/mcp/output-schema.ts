import { isRecordLike } from '@sim/utils/object'
import type { McpToolSchema } from '@/lib/mcp/types'

/**
 * The MCP block sub-block holding the selected operation's declared reply shape,
 * as a {@link McpToolOutputSnapshot}. Server-managed: the editor writes it when an
 * operation is picked, and `applyWorkflowOperations` writes it for agent edits.
 */
export const MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK = 'toolOutputSchema'

/** The MCP block output carrying a tool's `structuredContent`. */
export const MCP_STRUCTURED_CONTENT_OUTPUT = 'structuredContent'

const MAX_SHAPE_DEPTH = 8
const MAX_SHAPE_NODES = 500
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * The structure of a declared output schema: types, properties and array items
 * only. Descriptions, enums and examples are dropped because the snapshot is a
 * block input, and the executor and lint read every string in a block's inputs
 * as a possible `<block.path>` reference.
 */
export interface McpToolOutputShape {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'any'
  /** Declared fields of a closed object; absent when the object is open or undeclared. */
  properties?: Record<string, McpToolOutputShape>
  items?: McpToolOutputShape
}

/**
 * The reply shape of the operation a block was configured with. `schema` is
 * absent when the operation declares none, which records that discovery ran and
 * found nothing so an edit does not rediscover it. A snapshot applies only while
 * the block still targets the `server` and `tool` it was taken for.
 */
export interface McpToolOutputSnapshot {
  server: string
  tool: string
  schema?: McpToolOutputShape
}

/**
 * A tool's declared `outputSchema`, or `undefined` when it declares none. MCP
 * requires an object schema; the SDK rejects anything else at `tools/list`, and
 * a stored snapshot is held to the same rule.
 */
export function readMcpToolOutputSchema(value: unknown): McpToolSchema | undefined {
  if (!isRecordLike(value) || value.type !== 'object') return undefined
  return value as McpToolSchema
}

/** Reduce a declared JSON Schema to the structure a block output can declare. */
function toMcpToolOutputShape(schema: McpToolSchema): McpToolOutputShape {
  const budget = { nodes: MAX_SHAPE_NODES }
  return reduceNode(schema, 0, budget)
}

function reduceNode(node: unknown, depth: number, budget: { nodes: number }): McpToolOutputShape {
  budget.nodes--
  if (!isRecordLike(node) || budget.nodes < 0 || depth > MAX_SHAPE_DEPTH) return { type: 'any' }

  const variant = singleNonNullVariant(node)
  if (variant) return reduceNode(variant, depth, budget)
  if (node.$ref !== undefined || node.anyOf || node.oneOf || node.allOf || node.not) {
    return { type: 'any' }
  }

  switch (declaredType(node)) {
    case 'object': {
      const open =
        (node.additionalProperties !== undefined && node.additionalProperties !== false) ||
        node.patternProperties !== undefined
      if (open || !isRecordLike(node.properties)) return { type: 'object' }
      const properties: Record<string, McpToolOutputShape> = {}
      for (const [name, child] of Object.entries(node.properties)) {
        if (UNSAFE_PROPERTY_NAMES.has(name)) continue
        properties[name] = reduceNode(child, depth + 1, budget)
      }
      return { type: 'object', properties }
    }
    case 'array':
      return isRecordLike(node.items)
        ? { type: 'array', items: reduceNode(node.items, depth + 1, budget) }
        : { type: 'array' }
    case 'string':
      return { type: 'string' }
    case 'number':
    case 'integer':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    default:
      return { type: 'any' }
  }
}

/** `anyOf: [X, {type: 'null'}]`, the common encoding of an optional field, reads as X. */
function singleNonNullVariant(node: Record<string, unknown>): unknown {
  const variants = Array.isArray(node.anyOf) ? node.anyOf : node.oneOf
  if (!Array.isArray(variants)) return undefined
  const nonNull = variants.filter((variant) => !(isRecordLike(variant) && variant.type === 'null'))
  return nonNull.length === 1 && nonNull.length < variants.length ? nonNull[0] : undefined
}

function declaredType(node: Record<string, unknown>): string | undefined {
  if (typeof node.type === 'string') return node.type
  if (Array.isArray(node.type)) {
    const types = node.type.filter((type) => type !== 'null')
    return types.length === 1 && typeof types[0] === 'string' ? types[0] : undefined
  }
  if (node.properties !== undefined) return 'object'
  if (node.items !== undefined) return 'array'
  return undefined
}

export function createMcpToolOutputSnapshot(
  server: string,
  tool: string,
  outputSchema: McpToolSchema | undefined
): McpToolOutputSnapshot {
  return outputSchema
    ? { server, tool, schema: toMcpToolOutputShape(outputSchema) }
    : { server, tool }
}

const SHAPE_TYPES: ReadonlySet<string> = new Set([
  'object',
  'array',
  'string',
  'number',
  'boolean',
  'any',
])

function isShape(value: unknown, depth = 0): value is McpToolOutputShape {
  if (!isRecordLike(value) || typeof value.type !== 'string' || !SHAPE_TYPES.has(value.type)) {
    return false
  }
  if (depth > MAX_SHAPE_DEPTH + 1) return false
  if (value.items !== undefined && !isShape(value.items, depth + 1)) return false
  if (value.properties === undefined) return true
  return (
    isRecordLike(value.properties) &&
    Object.values(value.properties).every((child) => isShape(child, depth + 1))
  )
}

export function parseMcpToolOutputSnapshot(value: unknown): McpToolOutputSnapshot | undefined {
  if (!isRecordLike(value) || typeof value.server !== 'string' || typeof value.tool !== 'string') {
    return undefined
  }
  if (value.schema === undefined) return { server: value.server, tool: value.tool }
  if (!isShape(value.schema)) return undefined
  return { server: value.server, tool: value.tool, schema: value.schema }
}
