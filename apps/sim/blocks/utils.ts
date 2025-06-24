import type { BlockOutput, OutputConfig } from '@/blocks/types'

export function resolveOutputType(
  outputs: Record<string, OutputConfig | BlockOutput>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputValue] of Object.entries(outputs)) {
    // Handle backward compatibility: Check if the output is a primitive value or object (old format)
    if (
      typeof outputValue === 'string' ||
      (typeof outputValue === 'object' && outputValue !== null && !('type' in outputValue))
    ) {
      // This is a primitive BlockOutput value (old format like 'string', 'any', etc.)
      resolvedOutputs[key] = outputValue as BlockOutput
      continue
    }

    // OutputConfig with type
    const outputConfig = outputValue as OutputConfig
    resolvedOutputs[key] = outputConfig.type
  }

  return resolvedOutputs
}
