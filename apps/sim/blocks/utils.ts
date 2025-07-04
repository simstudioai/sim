import type { BlockOutput } from '@/blocks/types'

export function resolveOutputType(
  outputs: Record<string, string | BlockOutput>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputType] of Object.entries(outputs)) {
    // Since dependsOn has been removed, just use the type directly
    resolvedOutputs[key] = outputType as BlockOutput
  }

  return resolvedOutputs
}
