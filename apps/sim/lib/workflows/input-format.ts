import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'

/**
 * Simplified input field representation for workflow input mapping
 */
export interface WorkflowInputField {
  name: string
  type: string
  description?: string
}

/**
 * Extracts input fields from workflow blocks.
 * Finds the trigger block (start_trigger, input_trigger, or starter) and extracts its inputFormat.
 *
 * @param blocks - The blocks object from workflow state
 * @returns Array of input field definitions
 */
export function extractInputFieldsFromBlocks(
  blocks: Record<string, unknown> | null | undefined
): WorkflowInputField[] {
  if (!blocks) return []

  // Find trigger block
  const triggerEntry = Object.entries(blocks).find(([, block]) => {
    const b = block as Record<string, unknown>
    return typeof b.type === 'string' && isInputDefinitionTrigger(b.type)
  })

  if (!triggerEntry) return []

  const triggerBlock = triggerEntry[1] as Record<string, unknown>
  const subBlocks = triggerBlock.subBlocks as Record<string, { value?: unknown }> | undefined
  const inputFormat = subBlocks?.inputFormat?.value

  // Try primary location: subBlocks.inputFormat.value
  if (Array.isArray(inputFormat)) {
    return inputFormat
      .filter(
        (field: unknown): field is { name: string; type?: string; description?: string } =>
          typeof field === 'object' &&
          field !== null &&
          'name' in field &&
          typeof (field as { name: unknown }).name === 'string' &&
          (field as { name: string }).name.trim() !== ''
      )
      .map((field) => ({
        name: field.name,
        type: field.type || 'string',
        ...(field.description && { description: field.description }),
      }))
  }

  // Try legacy location: config.params.inputFormat
  const config = triggerBlock.config as { params?: { inputFormat?: unknown } } | undefined
  const legacyFormat = config?.params?.inputFormat

  if (Array.isArray(legacyFormat)) {
    return legacyFormat
      .filter(
        (field: unknown): field is { name: string; type?: string; description?: string } =>
          typeof field === 'object' &&
          field !== null &&
          'name' in field &&
          typeof (field as { name: unknown }).name === 'string' &&
          (field as { name: string }).name.trim() !== ''
      )
      .map((field) => ({
        name: field.name,
        type: field.type || 'string',
        ...(field.description && { description: field.description }),
      }))
  }

  return []
}

/**
 * Normalizes an input format value into a list of valid fields.
 *
 * Filters out:
 * - null or undefined values
 * - Empty arrays
 * - Non-array values
 * - Fields without names
 * - Fields with empty or whitespace-only names
 *
 * @param inputFormatValue - Raw input format value from subblock state
 * @returns Array of validated input format fields
 */
export function normalizeInputFormatValue(inputFormatValue: unknown): InputFormatField[] {
  // Handle null, undefined, and empty arrays
  if (
    inputFormatValue === null ||
    inputFormatValue === undefined ||
    (Array.isArray(inputFormatValue) && inputFormatValue.length === 0)
  ) {
    return []
  }

  // Handle non-array values
  if (!Array.isArray(inputFormatValue)) {
    return []
  }

  // Filter valid fields
  return inputFormatValue.filter(
    (field): field is InputFormatField =>
      field &&
      typeof field === 'object' &&
      typeof field.name === 'string' &&
      field.name.trim() !== ''
  )
}
