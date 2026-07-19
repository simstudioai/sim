import {
  FORM_FIELD_NAME_PATTERN,
  INTERFACE_LAYOUT_LIMITS,
  isReservedFormFieldName,
} from '@/lib/interfaces/constants'
import type { FormField, FormModuleConfig } from '@/lib/interfaces/types'

/**
 * Client mirror of the rules `collectFormFieldErrors` and the boundary contract
 * enforce, so the builder surfaces a violation inline instead of persisting a
 * layout the PATCH will reject.
 *
 * Shared by the row that renders the messages and the section that decides
 * whether the config is safe to save — both read one derivation, so a message
 * can never appear without also blocking the write.
 */
export interface FormFieldErrors {
  name: string | null
  label: string | null
  options: string | null
}

/**
 * Lowercased name → number of fields using it. `> 1` marks every member of a
 * duplicate set, which is what the uniqueness rule rejects.
 */
export function countFieldNames(fields: readonly FormField[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const field of fields) {
    const key = field.name.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function deriveNameError(name: string, duplicateName: boolean): string | null {
  if (name.length === 0) return 'Field name is required'
  if (!FORM_FIELD_NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, and underscores, starting with a letter or underscore'
  }
  if (name.length > INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH) {
    return `Field name must be ${INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH} characters or less`
  }
  if (isReservedFormFieldName(name)) {
    return `"${name}" is reserved by the workflow start block`
  }
  if (duplicateName) return 'Another field already uses this name'
  return null
}

/** Dropdown fields need at least one non-empty option before the layout will save. */
function deriveOptionsError(field: FormField): string | null {
  if (field.type !== 'dropdown') return null
  const options = field.options ?? []
  if (options.length === 0) return 'Add at least one option'
  if (options.some((option) => option.length === 0)) return 'Options cannot be empty'
  return null
}

export function deriveFormFieldErrors(field: FormField, duplicateName: boolean): FormFieldErrors {
  return {
    name: deriveNameError(field.name, duplicateName),
    label: field.label.length === 0 ? 'Field label is required' : null,
    options: deriveOptionsError(field),
  }
}

export function isFormFieldValid(errors: FormFieldErrors): boolean {
  return errors.name === null && errors.label === null && errors.options === null
}

/**
 * Whether the whole config is safe to persist. Callers report this alongside
 * every edit so the page never PATCHes an intermediate state that the contract
 * would reject and then roll back.
 */
export function isFormConfigValid(config: FormModuleConfig): boolean {
  const submitLabel = config.submitLabel.trim()
  if (submitLabel.length === 0) return false
  if (submitLabel.length > INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH) return false
  const counts = countFieldNames(config.fields)
  return config.fields.every((field) =>
    isFormFieldValid(deriveFormFieldErrors(field, (counts.get(field.name.toLowerCase()) ?? 0) > 1))
  )
}
