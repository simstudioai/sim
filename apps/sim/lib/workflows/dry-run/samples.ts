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

/** Placeholder output shaped like a tool's declared outputs; empty for a tool that declares none. */
export function sampleToolOutput(toolId: string): Record<string, unknown> {
  const outputs = getToolOutputsMetadata(toolId)
  return outputs ? generateMockPayloadFromOutputsDefinition(outputs) : {}
}
