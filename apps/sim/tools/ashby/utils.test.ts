/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ashbyErrorMessage, ashbyIsoDateTime, ashbyLimit } from '@/tools/ashby/utils'

describe('ashbyLimit', () => {
  it('omits unresolved optional values while preserving strict numeric validation', () => {
    expect(ashbyLimit(undefined)).toBeUndefined()
    expect(ashbyLimit(null)).toBeUndefined()
    expect(ashbyLimit('')).toBeUndefined()
    expect(ashbyLimit('   ')).toBeUndefined()
    expect(ashbyLimit(25)).toBe(25)
    expect(() => ashbyLimit(0)).toThrow(/integer from 1 to 100/)
    expect(() => ashbyLimit('25')).toThrow(/integer from 1 to 100/)
  })
})

describe('ashbyIsoDateTime', () => {
  it('preserves a valid provider date-time and rejects invalid input', () => {
    expect(ashbyIsoDateTime('2026-09-02T16:32:00Z', 'sendAt')).toBe('2026-09-02T16:32:00Z')
    expect(ashbyIsoDateTime('2026-09-02T16:32', 'sendAt')).toBe('2026-09-02T16:32')
    expect(() => ashbyIsoDateTime('tomorrow-ish', 'sendAt')).toThrow(/ISO 8601/)
    expect(() => ashbyIsoDateTime('2026-09-02', 'sendAt')).toThrow(/ISO 8601/)
    expect(() => ashbyIsoDateTime('2026-02-30T16:32:00Z', 'sendAt')).toThrow(/ISO 8601/)
  })
})

describe('ashbyErrorMessage', () => {
  it('reads the message out of the documented { message, parameter } entries', () => {
    // This is the shape Ashby's OpenAPI definition declares, and the one a 403
    // for a missing module permission arrives in. Stringifying the entry
    // directly yields '[object Object]' and hides the real cause.
    expect(
      ashbyErrorMessage(
        { success: false, errors: [{ message: 'missing_endpoint_permission' }] },
        'fallback'
      )
    ).toBe('missing_endpoint_permission')
  })

  it('names the offending parameter when Ashby supplies one', () => {
    expect(
      ashbyErrorMessage(
        { success: false, errors: [{ message: 'Invalid value', parameter: 'fieldValue' }] },
        'fallback'
      )
    ).toBe('Invalid value (fieldValue)')
  })

  it('joins multiple errors', () => {
    expect(
      ashbyErrorMessage(
        { success: false, errors: [{ message: 'a' }, { message: 'b' }] },
        'fallback'
      )
    ).toBe('a; b')
  })

  it('still handles the plain string array form', () => {
    expect(ashbyErrorMessage({ success: false, errors: ['boom'] }, 'fallback')).toBe('boom')
  })

  it('prefers errorInfo.message, the other documented shape', () => {
    expect(
      ashbyErrorMessage({ success: false, errorInfo: { message: 'rate limited' } }, 'fallback')
    ).toBe('rate limited')
  })

  it('falls back when the entries carry no usable message', () => {
    expect(ashbyErrorMessage({ success: false, errors: [{ parameter: 'x' }] }, 'fallback')).toBe(
      'fallback'
    )
    expect(ashbyErrorMessage({ success: false, errors: [] }, 'fallback')).toBe('fallback')
    expect(ashbyErrorMessage(null, 'fallback')).toBe('fallback')
  })
})
