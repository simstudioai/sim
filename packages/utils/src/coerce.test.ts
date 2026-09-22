/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from './coerce.js'

describe('toStringOrNull', () => {
  it('returns the value when it is a string, including empty', () => {
    expect(toStringOrNull('x')).toBe('x')
    expect(toStringOrNull('')).toBe('')
  })

  it('returns null for every non-string', () => {
    expect(toStringOrNull(1)).toBeNull()
    expect(toStringOrNull(null)).toBeNull()
    expect(toStringOrNull(undefined)).toBeNull()
    expect(toStringOrNull(['x'])).toBeNull()
    expect(toStringOrNull(new String('x'))).toBeNull()
  })
})

describe('toNumberOrNull', () => {
  it('returns the value when it is a number, including 0', () => {
    expect(toNumberOrNull(0)).toBe(0)
    expect(toNumberOrNull(-1.5)).toBe(-1.5)
  })

  /* A typeof test, not a finiteness test — the TSDoc says so, so pin it. */
  it('passes NaN and the infinities through', () => {
    expect(toNumberOrNull(Number.NaN)).toBeNaN()
    expect(toNumberOrNull(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns null for a numeric string', () => {
    expect(toNumberOrNull('1')).toBeNull()
  })
})

describe('toBooleanOrNull', () => {
  it('returns the value when it is a boolean, including false', () => {
    expect(toBooleanOrNull(false)).toBe(false)
    expect(toBooleanOrNull(true)).toBe(true)
  })

  it('returns null for a truthy non-boolean', () => {
    expect(toBooleanOrNull(1)).toBeNull()
    expect(toBooleanOrNull('true')).toBeNull()
  })
})
