/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isSubBlockRequired,
  isToolParamUserRequired,
  isUserSuppliedToolParam,
} from '@/lib/workflows/tool-input/param-visibility'

describe('isUserSuppliedToolParam', () => {
  it('is true only for user-only', () => {
    expect(isUserSuppliedToolParam({ paramVisibility: 'user-only' })).toBe(true)
    expect(isUserSuppliedToolParam({ paramVisibility: 'user-or-llm' })).toBe(false)
    expect(isUserSuppliedToolParam({ paramVisibility: 'llm-only' })).toBe(false)
    expect(isUserSuppliedToolParam({ paramVisibility: 'hidden' })).toBe(false)
  })

  it('treats an undeclared visibility as user-or-llm', () => {
    // Matches the tool-row renderer's fallback: an unannotated param is never user-required.
    expect(isUserSuppliedToolParam({})).toBe(false)
  })
})

describe('isToolParamUserRequired', () => {
  it('requires both user-only visibility and a satisfied required condition', () => {
    expect(isToolParamUserRequired({ paramVisibility: 'user-only', required: true }, {})).toBe(true)
    expect(isToolParamUserRequired({ paramVisibility: 'user-only', required: false }, {})).toBe(
      false
    )
  })

  it('never requires a param the model can supply, even when required is true', () => {
    // `required: true` still drives the model-facing schema; it just is not the USER's to fill.
    expect(isToolParamUserRequired({ paramVisibility: 'user-or-llm', required: true }, {})).toBe(
      false
    )
    expect(isToolParamUserRequired({ paramVisibility: 'llm-only', required: true }, {})).toBe(false)
  })

  it('evaluates the condition form against the surrounding values', () => {
    const config = {
      paramVisibility: 'user-only' as const,
      required: { field: 'operation', value: ['write'] },
    }
    expect(isToolParamUserRequired(config, { operation: 'write' })).toBe(true)
    expect(isToolParamUserRequired(config, { operation: 'read' })).toBe(false)
  })
})

describe('isSubBlockRequired', () => {
  it('handles the boolean and absent forms', () => {
    expect(isSubBlockRequired(true, {})).toBe(true)
    expect(isSubBlockRequired(false, {})).toBe(false)
    expect(isSubBlockRequired(undefined, {})).toBe(false)
  })

  it('evaluates the condition form', () => {
    const required = { field: 'operation', value: ['write', 'read-bulk'] }
    expect(isSubBlockRequired(required, { operation: 'write' })).toBe(true)
    expect(isSubBlockRequired(required, { operation: 'search' })).toBe(false)
  })
})
