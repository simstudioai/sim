/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ashbyErrorMessage } from '@/tools/ashby/utils'

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
