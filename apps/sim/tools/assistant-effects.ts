import assistantToolEffects from '@/tools/generated/assistant-tool-effects'
import type { AssistantOperationMetadata } from '@/tools/types'

/**
 * The Assistant review effect of a tool call, or `undefined` when the tool is not
 * Assistant-reviewed. Answers exactly what `getToolMetadata(name)?.assistant?.effect` does,
 * unversioned names included, from a generated map of a few dozen entries instead of the ~4 MB
 * tool metadata, so every chat surface can ask it.
 */
export function getAssistantToolEffect(
  toolName: string
): AssistantOperationMetadata['effect'] | undefined {
  return Object.hasOwn(assistantToolEffects, toolName) ? assistantToolEffects[toolName] : undefined
}
