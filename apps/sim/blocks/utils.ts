import type { BlockOutput, OutputFieldDefinition, SubBlockConfig } from '@/blocks/types'

/**
 * Checks if a field is included in the dependsOn config.
 * Handles both simple array format and object format with all/any fields.
 */
export function isDependency(dependsOn: SubBlockConfig['dependsOn'], field: string): boolean {
  if (!dependsOn) return false
  if (Array.isArray(dependsOn)) return dependsOn.includes(field)
  return dependsOn.all?.includes(field) || dependsOn.any?.includes(field) || false
}

/**
 * Gets all dependency fields as a flat array.
 * Handles both simple array format and object format with all/any fields.
 */
export function getDependsOnFields(dependsOn: SubBlockConfig['dependsOn']): string[] {
  if (!dependsOn) return []
  if (Array.isArray(dependsOn)) return dependsOn
  return [...(dependsOn.all || []), ...(dependsOn.any || [])]
}

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
