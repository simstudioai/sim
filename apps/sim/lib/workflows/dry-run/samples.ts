import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/outputs'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'

/** Placeholder output shaped like a block's real one, for the operation its params configure. */
export function sampleBlockOutput(block: {
  type: string
  params: Record<string, unknown>
}): Record<string, unknown> {
  const subBlocks: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(block.params)) subBlocks[key] = { value }
  return generateMockPayloadFromOutputsDefinition(getEffectiveBlockOutputs(block.type, subBlocks))
}

/** Placeholder output shaped like a tool's declared outputs; empty for a tool that declares none. */
export function sampleToolOutput(toolId: string): Record<string, unknown> {
  const outputs = getToolOutputsMetadata(toolId)
  return outputs ? generateMockPayloadFromOutputsDefinition(outputs) : {}
}
