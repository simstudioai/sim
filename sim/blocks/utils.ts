import { SubBlockState } from '@/stores/workflows/workflow/types'
import { BlockOutput, OutputConfig } from '@/blocks/types'

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
  outputs: Record<string, OutputConfig>,
  subBlocks: Record<string, SubBlockState>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputConfig] of Object.entries(outputs)) {
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
