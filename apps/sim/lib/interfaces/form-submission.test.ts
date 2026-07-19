/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import { validateFormSubmission } from '@/lib/interfaces/form-submission'
import type { FormField } from '@/lib/interfaces/types'

const { MAX_FORM_VALUE_LENGTH } = INTERFACE_LAYOUT_LIMITS

function field(overrides?: Partial<FormField>): FormField {
  return {
    id: 'field-1',
    name: 'email',
    label: 'Email',
    type: 'short-text',
    required: false,
    ...overrides,
  }
}

function expectInvalid(
  result: ReturnType<typeof validateFormSubmission>
): Extract<ReturnType<typeof validateFormSubmission>, { valid: false }> {
  expect(result.valid).toBe(false)
  if (result.valid) throw new Error('expected an invalid result')
  return result
}

describe('validateFormSubmission', () => {
  it('returns the input keyed by field name', () => {
    const result = validateFormSubmission([field({ id: 'f1', name: 'customer_email' })], {
      f1: 'a@b.co',
    })
    expect(result).toEqual({ valid: true, input: { customer_email: 'a@b.co' } })
  })

  it('rejects unknown field ids', () => {
    const result = expectInvalid(validateFormSubmission([field({ id: 'f1' })], { nope: 'x' }))
    expect(result.errors).toEqual([{ fieldId: 'nope', message: 'Unknown field id "nope"' }])
  })

  it('rejects a missing required text field', () => {
    const result = expectInvalid(validateFormSubmission([field({ id: 'f1', required: true })], {}))
    expect(result.errors[0]).toEqual({ fieldId: 'f1', message: 'Email is required' })
  })

  it('rejects a whitespace-only required text field', () => {
    const result = expectInvalid(
      validateFormSubmission([field({ id: 'f1', required: true })], { f1: '   ' })
    )
    expect(result.errors[0].message).toBe('Email is required')
  })

  it('omits missing optional fields from the input', () => {
    const result = validateFormSubmission(
      [field({ id: 'f1', name: 'notes' }), field({ id: 'f2', name: 'topic' })],
      { f2: 'billing' }
    )
    expect(result).toEqual({ valid: true, input: { topic: 'billing' } })
  })

  it('defaults a missing switch to false', () => {
    const result = validateFormSubmission(
      [field({ id: 'f1', name: 'urgent', type: 'switch', required: true })],
      {}
    )
    expect(result).toEqual({ valid: true, input: { urgent: false } })
  })

  it('rejects a non-boolean switch value', () => {
    const result = expectInvalid(
      validateFormSubmission(
        [field({ id: 'f1', name: 'urgent', label: 'Urgent', type: 'switch' })],
        { f1: 'true' }
      )
    )
    expect(result.errors[0]).toEqual({ fieldId: 'f1', message: 'Urgent must be a boolean' })
  })

  it('passes a boolean switch value through', () => {
    const result = validateFormSubmission([field({ id: 'f1', name: 'urgent', type: 'switch' })], {
      f1: true,
    })
    expect(result).toEqual({ valid: true, input: { urgent: true } })
  })

  it('rejects a dropdown value that is not one of the options', () => {
    const result = expectInvalid(
      validateFormSubmission(
        [
          field({
            id: 'f1',
            name: 'priority',
            label: 'Priority',
            type: 'dropdown',
            options: ['low', 'high'],
          }),
        ],
        { f1: 'medium' }
      )
    )
    expect(result.errors[0]).toEqual({
      fieldId: 'f1',
      message: 'Priority must be one of the available options',
    })
  })

  it('accepts a dropdown value that is a member of the options', () => {
    const result = validateFormSubmission(
      [field({ id: 'f1', name: 'priority', type: 'dropdown', options: ['low', 'high'] })],
      { f1: 'high' }
    )
    expect(result).toEqual({ valid: true, input: { priority: 'high' } })
  })

  it('rejects a missing required dropdown', () => {
    const result = expectInvalid(
      validateFormSubmission(
        [
          field({
            id: 'f1',
            name: 'priority',
            label: 'Priority',
            type: 'dropdown',
            required: true,
            options: ['low'],
          }),
        ],
        {}
      )
    )
    expect(result.errors[0].message).toBe('Priority is required')
  })

  it('rejects a boolean value on a text field', () => {
    const result = expectInvalid(validateFormSubmission([field({ id: 'f1' })], { f1: true }))
    expect(result.errors[0].message).toBe('Email must be a string')
  })

  it('rejects string values over the maximum length', () => {
    const result = expectInvalid(
      validateFormSubmission(
        [field({ id: 'f1', name: 'body', label: 'Body', type: 'long-text' })],
        { f1: 'x'.repeat(MAX_FORM_VALUE_LENGTH + 1) }
      )
    )
    expect(result.errors[0].message).toBe(
      `Body exceeds the maximum length of ${MAX_FORM_VALUE_LENGTH} characters`
    )
  })

  it('accumulates errors across fields', () => {
    const result = expectInvalid(
      validateFormSubmission(
        [
          field({ id: 'f1', name: 'a', label: 'A', required: true }),
          field({ id: 'f2', name: 'b', label: 'B', type: 'switch' }),
        ],
        { f2: 'yes', ghost: 'x' }
      )
    )
    expect(result.errors).toHaveLength(3)
    expect(result.errors.map((e) => e.fieldId).sort()).toEqual(['f1', 'f2', 'ghost'])
  })

  it('falls back to the field name when the label is empty', () => {
    const result = expectInvalid(
      validateFormSubmission([field({ id: 'f1', name: 'email', label: '', required: true })], {})
    )
    expect(result.errors[0].message).toBe('email is required')
  })
})
