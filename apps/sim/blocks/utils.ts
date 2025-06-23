import type { BlockOutput, OutputConfig } from '@/blocks/types'
import type { SubBlockState } from '@/stores/workflows/workflow/types'

interface CodeLine {
  id: string
  content: string
}

function isEmptyValue(value: SubBlockState['value']): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'number') return false
  if (Array.isArray(value)) {
    // Handle code editor's array of lines format
    if (value.length === 0) return true
    if (isCodeEditorValue(value)) {
      return value.every((line: any) => !line.content.trim())
    }
    return value.length === 0
  }
  return false
}

function isCodeEditorValue(value: any[]): value is CodeLine[] {
  return value.length > 0 && 'id' in value[0] && 'content' in value[0]
}

export function resolveOutputType(
  outputs: Record<string, OutputConfig | BlockOutput>,
  subBlocks: Record<string, SubBlockState>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputValue] of Object.entries(outputs)) {
    // Handle backward compatibility: Check if the output is a primitive value or object (old format)
    // If it's a string OR an object without 'type' and 'dependsOn' properties, it's the old format
    if (
      typeof outputValue === 'string' ||
      (typeof outputValue === 'object' &&
        outputValue !== null &&
        !('type' in outputValue) &&
        !('dependsOn' in outputValue))
    ) {
      // This is a primitive BlockOutput value (old format like 'string', 'any', etc.)
      resolvedOutputs[key] = outputValue as BlockOutput
      continue
    }

    // Handle new format: OutputConfig with type and optional dependsOn
    const outputConfig = outputValue as OutputConfig

    // If no dependencies, use the type directly
    if (!outputConfig.dependsOn) {
      resolvedOutputs[key] = outputConfig.type
      continue
    }

    // Handle dependent output types
    const subBlock = subBlocks[outputConfig.dependsOn.subBlockId]
    resolvedOutputs[key] = isEmptyValue(subBlock?.value)
      ? outputConfig.dependsOn.condition.whenEmpty
      : outputConfig.dependsOn.condition.whenFilled
  }

  return resolvedOutputs
}
