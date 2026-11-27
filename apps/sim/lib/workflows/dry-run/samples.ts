import { isPlainRecord } from '@sim/utils/object'
import {
  type McpToolOutputShape,
  readMcpToolOutputSchema,
  toMcpToolOutputShape,
} from '@/lib/mcp/output-schema'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/outputs'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import { isRunControlledOutputField } from '@/executor/utils/mock-output'
import { dryRunId, dryRunNumber } from '@/tools/dry-run'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'

/** A field name as a placeholder token's kind: `rowId` is `row_id`. */
function tokenKind(field: string): string {
  const kind = field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return kind || 'value'
}

/**
 * `sample` with every string a placeholder token (`dry_run_<field>_<n>`, numbered per field) and
 * every number a placeholder number (`dryRunNumber`), so a value the sample made up is
 * recognisably not real wherever it flows, and a read that would send it is known to depend on a
 * stub. An array item's fields are named by their own keys.
 */
function mintPlaceholders(sample: Record<string, unknown>): Record<string, unknown> {
  const counts = new Map<string, number>()
  let numbers = 0
  const mint = (field: string): string => {
    const kind = tokenKind(field)
    const n = (counts.get(kind) ?? 0) + 1
    counts.set(kind, n)
    return dryRunId(kind, n)
  }
  const visit = (value: unknown, field: string): unknown => {
    if (typeof value === 'string') return mint(field)
    if (typeof value === 'number') return dryRunNumber(++numbers)
    if (Array.isArray(value)) return value.map((item) => visit(item, field))
    if (!isPlainRecord(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, key)]))
  }
  return Object.fromEntries(Object.entries(sample).map(([key, item]) => [key, visit(item, key)]))
}

/**
 * Placeholder output shaped like a block's real one, for the operation its params configure, its
 * strings and numbers placeholders. Data only, like a mock: no field the run's execution, trace or
 * billing reads.
 */
export function sampleBlockOutput(block: {
  type: string
  params: Record<string, unknown>
}): Record<string, unknown> {
  const subBlocks: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(block.params)) subBlocks[key] = { value }
  const outputs = getEffectiveBlockOutputs(block.type, subBlocks)
  const sample = withEmptyFileLists(
    outputs,
    mintPlaceholders(generateMockPayloadFromOutputsDefinition(outputs))
  )
  return Object.fromEntries(
    Object.entries(sample).filter(([field]) => !isRunControlledOutputField(field))
  )
}

/** The fields a declared output lays out: its `properties`, or a nested map of fields. */
function declaredFields(output: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(output)) return null
  if (typeof output.type !== 'string') return output
  return (output.type === 'object' || output.type === 'json') && isPlainRecord(output.properties)
    ? output.properties
    : null
}

/**
 * `value` with each `file[]` its declared `output` holds empty, through declared fields and array
 * items: a placeholder stores no file to reference.
 */
function emptyFileLists(output: unknown, value: unknown): unknown {
  if (isPlainRecord(output) && output.type === 'file[]') return []
  const fields = declaredFields(output)
  if (fields) return isPlainRecord(value) ? withEmptyFileLists(fields, value) : value
  if (isPlainRecord(output) && output.type === 'array' && Array.isArray(value)) {
    return value.map((item) => emptyFileLists(output.items, item))
  }
  return value
}

/** {@link emptyFileLists} over each field of a sample of `fields`. */
function withEmptyFileLists(
  fields: Record<string, unknown>,
  sample: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sample).map(([field, value]) => [field, emptyFileLists(fields[field], value)])
  )
}

/**
 * `echoed` laid over `sample` by the declared `output`: field by field where it declares fields,
 * item by item where it declares an array's `items`, and anywhere else `echoed` replaces the sample
 * whole.
 */
function overlay(output: unknown, sample: unknown, echoed: unknown): unknown {
  if (echoed === undefined) return sample
  const fields = declaredFields(output)
  if (fields) {
    return isPlainRecord(echoed) && isPlainRecord(sample)
      ? overlayFields(fields, sample, echoed)
      : echoed
  }
  if (isPlainRecord(output) && output.type === 'array' && isPlainRecord(output.items)) {
    if (!Array.isArray(echoed)) return echoed
    const item = Array.isArray(sample) ? sample[0] : undefined
    return echoed.map((entry) => overlay(output.items, item, entry))
  }
  return echoed
}

/** The sample's declared fields, each with what `echoed` holds for it laid over it. */
function overlayFields(
  fields: Record<string, unknown>,
  sample: Record<string, unknown>,
  echoed: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sample).map(([field, value]) => [
      field,
      Object.hasOwn(echoed, field) ? overlay(fields[field], value, echoed[field]) : value,
    ])
  )
}

/**
 * A discovered output schema (an MCP tool's `outputSchema`), reduced within the same node and
 * depth budget a block's saved MCP output snapshot uses, as an output declaration the sample
 * reads. A field whose type cannot be told is left out rather than sampled as a guess.
 */
function outputFromShape(shape: McpToolOutputShape): Record<string, unknown> | undefined {
  switch (shape.type) {
    case 'object': {
      const properties: Record<string, unknown> = {}
      for (const [field, child] of Object.entries(shape.properties ?? {})) {
        const output = outputFromShape(child)
        if (output) properties[field] = output
      }
      return { type: 'object', properties }
    }
    case 'array': {
      const items = shape.items && outputFromShape(shape.items)
      return items ? { type: 'array', items } : undefined
    }
    case 'any':
      return undefined
    default:
      return { type: shape.type }
  }
}

/**
 * Placeholder output shaped like a tool's declared outputs, and the `discovered` outputs a call
 * learned beside them as JSON Schemas (an MCP tool's `outputSchema`, as `structuredContent`), its
 * strings and numbers placeholders; empty for a tool that declares none. `echoed`, the tool's
 * `dryRunOutput`, is laid over the sample by the declared schema (see `ToolConfig.dryRunOutput`).
 */
export function sampleToolOutput(
  toolId: string,
  echoed: Record<string, unknown> | null = null,
  discovered?: Record<string, unknown>
): Record<string, unknown> {
  const declared = getToolOutputsMetadata(toolId)
  if (!declared && !discovered) return {}
  const outputs: Record<string, unknown> = { ...declared }
  for (const [field, schema] of Object.entries(discovered ?? {})) {
    const objectSchema = readMcpToolOutputSchema(schema)
    const output = objectSchema && outputFromShape(toMcpToolOutputShape(objectSchema))
    if (output) outputs[field] = output
  }
  const sample = withEmptyFileLists(
    outputs,
    mintPlaceholders(generateMockPayloadFromOutputsDefinition(outputs))
  )
  return echoed ? overlayFields(outputs, sample, echoed) : sample
}
