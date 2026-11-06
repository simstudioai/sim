import { describe, expect, it } from 'vitest'
import {
  isSubBlockRequired,
  isUserSuppliedToolParam,
  resolveToolParamRequired,
} from '@/lib/workflows/tool-input/param-visibility'
import type { ParameterVisibility } from '@/tools/types'

describe('isUserSuppliedToolParam', () => {
  it('is true only for user-only', () => {
    expect(isUserSuppliedToolParam({ paramVisibility: 'user-only' })).toBe(true)
    expect(isUserSuppliedToolParam({ paramVisibility: 'user-or-llm' })).toBe(false)
    expect(isUserSuppliedToolParam({ paramVisibility: 'llm-only' })).toBe(false)
    expect(isUserSuppliedToolParam({ paramVisibility: 'hidden' })).toBe(false)
  })
})

describe('resolveToolParamRequired', () => {
  const visibleAs = (paramVisibility: ParameterVisibility) => new Map([['param', paramVisibility]])

  it('requires both user-only visibility and a satisfied required condition', () => {
    expect(
      resolveToolParamRequired({ id: 'param', required: true }, {}, visibleAs('user-only'))
    ).toBe(true)
    expect(
      resolveToolParamRequired({ id: 'param', required: false }, {}, visibleAs('user-only'))
    ).toBe(false)
  })

  it('never requires a param the model can supply, even when required is true', () => {
    // `required: true` still drives the model-facing schema; it just is not the USER's to fill.
    expect(
      resolveToolParamRequired({ id: 'param', required: true }, {}, visibleAs('user-or-llm'))
    ).toBe(false)
    expect(
      resolveToolParamRequired({ id: 'param', required: true }, {}, visibleAs('llm-only'))
    ).toBe(false)
  })

  it('evaluates the condition form against the surrounding values', () => {
    const config = { id: 'param', required: { field: 'operation', value: ['write'] } }
    expect(resolveToolParamRequired(config, { operation: 'write' }, visibleAs('user-only'))).toBe(
      true
    )
    expect(resolveToolParamRequired(config, { operation: 'read' }, visibleAs('user-only'))).toBe(
      false
    )
  })
})

describe('isSubBlockRequired', () => {
  it('evaluates the condition form', () => {
    const required = { field: 'operation', value: ['write', 'read-bulk'] }
    expect(isSubBlockRequired(required, { operation: 'write' })).toBe(true)
    expect(isSubBlockRequired(required, { operation: 'search' })).toBe(false)
  })
})
