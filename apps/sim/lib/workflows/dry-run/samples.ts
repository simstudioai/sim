import { isPlainRecord } from '@sim/utils/object'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/outputs'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import { isRunControlledOutputField } from '@/executor/utils/mock-output'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'

/**
 * Placeholder output shaped like a block's real one, for the operation its params configure.
 * Data only, like a mock: no field the run's execution, trace or billing reads.
 */
export function sampleBlockOutput(block: {
  type: string
  params: Record<string, unknown>
}): Record<string, unknown> {
  const subBlocks: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(block.params)) subBlocks[key] = { value }
  const sample = generateMockPayloadFromOutputsDefinition(
    getEffectiveBlockOutputs(block.type, subBlocks)
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
 * Placeholder output shaped like a tool's declared outputs; empty for a tool that declares none.
 * `echoed`, the tool's `dryRunOutput`, is laid over the sample by the declared schema (see
 * `ToolConfig.dryRunOutput`).
 */
export function sampleToolOutput(
  toolId: string,
  echoed: Record<string, unknown> | null = null
): Record<string, unknown> {
  const outputs = getToolOutputsMetadata(toolId)
  if (!outputs) return {}
  const sample = generateMockPayloadFromOutputsDefinition(outputs)
  return echoed ? overlayFields(outputs, sample, echoed) : sample
}
