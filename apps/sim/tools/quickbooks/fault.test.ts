/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { formatQuickBooksFaultDetail, sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'

describe('QuickBooks fault handling', () => {
  it('retains only documented fields and bounds remote error content', () => {
    const fault = sanitizeQuickBooksFaultData({
      Fault: {
        Error: Array.from({ length: 7 }, (_, index) => ({
          code: String(index),
          Message: `message-${index}`,
          Detail: 'x'.repeat(600),
          injected: 'must not escape',
        })),
      },
    })

    expect(fault?.Fault.Error).toHaveLength(5)
    expect(fault?.Fault.omittedErrorCount).toBe(2)
    expect(fault?.Fault.Error[0]).not.toHaveProperty('injected')
    expect(fault?.Fault.Error[0].Detail).toHaveLength(500)
  })

  it('preserves omission counts across repeated sanitization', () => {
    const first = sanitizeQuickBooksFaultData({
      Fault: {
        Error: Array.from({ length: 6 }, (_, index) => ({
          Message: `error-${index}`,
        })),
      },
    })
    const second = sanitizeQuickBooksFaultData(first)

    expect(second?.Fault.omittedErrorCount).toBe(1)
  })

  it('adds actionable stale SyncToken guidance', () => {
    const fault = sanitizeQuickBooksFaultData({
      Fault: {
        Error: [
          {
            code: '5010',
            Message: 'Stale Object Error',
            Detail: 'You and another user were working on this at the same time.',
            element: 'SyncToken',
          },
        ],
      },
    })

    expect(fault).not.toBeNull()
    expect(formatQuickBooksFaultDetail(fault!)).toContain(
      'Re-read the record to obtain its current SyncToken, then retry the write.'
    )
  })

  it('renders code-only and element-only faults without discarding them', () => {
    const codeOnly = sanitizeQuickBooksFaultData({ Fault: { Error: [{ code: '5010' }] } })
    const elementOnly = sanitizeQuickBooksFaultData({
      Fault: { Error: [{ element: 'SyncToken' }] },
    })

    expect(formatQuickBooksFaultDetail(codeOnly!)).toBe(
      '5010 Re-read the record to obtain its current SyncToken, then retry the write.'
    )
    expect(formatQuickBooksFaultDetail(elementOnly!)).toBe('element: SyncToken')
  })

  it.each([
    ['ValidationFault', 'ValidationFault'],
    ['Validation', 'ValidationFault'],
    ['AuthenticationFault', 'AuthenticationFault'],
    ['Authentication', 'AuthenticationFault'],
    ['AuthorizationFault', 'AuthorizationFault'],
    ['SystemFault', 'SystemFault'],
  ])('reports the documented fault classification for type %s', (type, expected) => {
    const fault = sanitizeQuickBooksFaultData({
      Fault: { type, Error: [{ code: '6240', Message: 'Duplicate Name Exists Error' }] },
    })

    expect(fault?.Fault.type).toBe(expected)
    expect(formatQuickBooksFaultDetail(fault!)).toBe(
      `${expected}: 6240: Duplicate Name Exists Error`
    )
  })

  it('preserves the classification across repeated sanitization', () => {
    const first = sanitizeQuickBooksFaultData({
      Fault: { type: 'AuthenticationFault', Error: [{ Message: 'message' }] },
    })

    expect(sanitizeQuickBooksFaultData(first)?.Fault.type).toBe('AuthenticationFault')
  })

  it('omits the classification when Intuit does not send one', () => {
    const fault = sanitizeQuickBooksFaultData({ Fault: { Error: [{ Message: 'message' }] } })

    expect(fault?.Fault).not.toHaveProperty('type')
    expect(formatQuickBooksFaultDetail(fault!)).toBe('message')
  })

  it.each([null, [], {}, { Fault: {} }, { Fault: { Error: [] } }])(
    'does not claim malformed fault payloads: %j',
    (payload) => {
      expect(sanitizeQuickBooksFaultData(payload)).toBeNull()
    }
  )
})
