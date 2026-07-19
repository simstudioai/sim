/**
 * Server-side validation for interface form submissions.
 *
 * Submitted values arrive keyed by form field **id** (stable across renames);
 * the returned workflow input is keyed by field **name** (the start-block
 * input key). The submit route turns a failed result into a 400 with the
 * typed per-field error list.
 */

import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import type { FormField } from '@/lib/interfaces/types'

export interface FormSubmissionFieldError {
  /** Field id from the stored form definition, or the unknown submitted key. */
  fieldId: string
  message: string
}

export type FormSubmissionResult =
  | { valid: true; input: Record<string, string | boolean> }
  | { valid: false; errors: FormSubmissionFieldError[] }

function fieldDisplayName(field: FormField): string {
  return field.label.length > 0 ? field.label : field.name
}

/**
 * Validates `values` (keyed by field id) against the stored field
 * definitions and builds the workflow input record (keyed by field name).
 *
 * Rules: unknown field ids are rejected; required fields are enforced
 * (a missing switch defaults to `false`); dropdown values must be one of the
 * field's options; switch values must be strictly boolean; string values are
 * capped at {@link INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH} characters.
 */
export function validateFormSubmission(
  fields: FormField[],
  values: Record<string, string | boolean>
): FormSubmissionResult {
  const errors: FormSubmissionFieldError[] = []
  const fieldById = new Map<string, FormField>()
  for (const field of fields) {
    fieldById.set(field.id, field)
  }

  for (const submittedId of Object.keys(values)) {
    if (!fieldById.has(submittedId)) {
      errors.push({ fieldId: submittedId, message: `Unknown field id "${submittedId}"` })
    }
  }

  const input: Record<string, string | boolean> = {}

  for (const field of fields) {
    const raw = values[field.id]
    const display = fieldDisplayName(field)

    if (field.type === 'switch') {
      if (raw === undefined) {
        input[field.name] = false
      } else if (typeof raw !== 'boolean') {
        errors.push({ fieldId: field.id, message: `${display} must be a boolean` })
      } else {
        input[field.name] = raw
      }
      continue
    }

    if (raw === undefined || raw === '') {
      if (field.required) {
        errors.push({ fieldId: field.id, message: `${display} is required` })
      }
      continue
    }

    if (typeof raw !== 'string') {
      errors.push({ fieldId: field.id, message: `${display} must be a string` })
      continue
    }

    if (raw.length > INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH) {
      errors.push({
        fieldId: field.id,
        message: `${display} exceeds the maximum length of ${INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH} characters`,
      })
      continue
    }

    if (field.type === 'dropdown') {
      if (!field.options?.includes(raw)) {
        errors.push({
          fieldId: field.id,
          message: `${display} must be one of the available options`,
        })
        continue
      }
    } else if (field.required && raw.trim().length === 0) {
      errors.push({ fieldId: field.id, message: `${display} is required` })
      continue
    }

    input[field.name] = raw
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, input }
}
