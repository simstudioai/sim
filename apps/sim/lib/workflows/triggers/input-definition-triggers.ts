/**
 * Trigger types that define workflow input parameters (inputFormat).
 * These are triggers where users can configure input schema for the workflow.
 *
 * This module is kept lightweight with no dependencies to avoid circular imports.
 *
 * Note: External triggers like webhook/schedule are NOT included here because
 * they receive input from external event payloads, not user-defined inputFormat.
 */
export const INPUT_DEFINITION_TRIGGER_TYPES = [
  'starter',
  'start',
  'start_trigger',
  'api_trigger',
  'input_trigger',
] as const

export type InputDefinitionTriggerType = (typeof INPUT_DEFINITION_TRIGGER_TYPES)[number]

/**
 * Check if a block type is a trigger that defines workflow input parameters.
 * Used to find blocks that have inputFormat subblock for workflow input schema.
 */
export function isInputDefinitionTrigger(
  blockType: string
): blockType is InputDefinitionTriggerType {
  return INPUT_DEFINITION_TRIGGER_TYPES.includes(blockType as InputDefinitionTriggerType)
}
