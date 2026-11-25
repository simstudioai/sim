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

/**
 * `value` with what it leaves out taken from `sample`: a record field by field, and each item of
 * an array from the sample's first item.
 */
function fillFromSample(sample: unknown, value: unknown): unknown {
  if (value === undefined) return sample
  if (Array.isArray(value)) {
    const item = Array.isArray(sample) ? sample[0] : undefined
    return value.map((entry) => fillFromSample(item, entry))
  }
  if (!isPlainRecord(value) || !isPlainRecord(sample)) return value
  return Object.fromEntries([
    ...Object.entries(sample),
    ...Object.entries(value).map(([key, entry]) => [
      key,
      fillFromSample(Object.hasOwn(sample, key) ? sample[key] : undefined, entry),
    ]),
  ])
}

/**
 * Placeholder output shaped like a tool's declared outputs; empty for a tool that declares none.
 * `echoed`, what the tool's `dryRunOutput` derived from the request it would have sent, fills each
 * declared output it names, and the sample everything else.
 */
export function sampleToolOutput(
  toolId: string,
  echoed: Record<string, unknown> | null = null
): Record<string, unknown> {
  const outputs = getToolOutputsMetadata(toolId)
  const sample = outputs ? generateMockPayloadFromOutputsDefinition(outputs) : {}
  if (!echoed) return sample
  return Object.fromEntries(
    Object.entries(sample).map(([field, value]) => [
      field,
      Object.hasOwn(echoed, field) ? fillFromSample(value, echoed[field]) : value,
    ])
  )
}
