import type { BlockOutput, OutputFieldDefinition } from '@/blocks/types'

export function resolveOutputType(
  outputs: Record<string, OutputFieldDefinition>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputType] of Object.entries(outputs)) {
    // Handle new format: { type: 'string', description: '...' }
    if (typeof outputType === 'object' && outputType !== null && 'type' in outputType) {
      resolvedOutputs[key] = outputType.type as BlockOutput
    } else {
      // Handle old format: just the type as string, or other object formats
      resolvedOutputs[key] = outputType as BlockOutput
    }
  }

  return resolvedOutputs
}
