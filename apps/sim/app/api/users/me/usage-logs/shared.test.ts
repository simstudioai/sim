/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'

describe('resolveDateRange', () => {
  it('throws when period is "custom" without a startDate', () => {
    expect(() => resolveDateRange('custom', undefined, undefined)).toThrow(
      'startDate is required when period is "custom"'
    )
  })

  it('defaults endDate to now when omitted for a custom period', () => {
    const range = resolveDateRange('custom', '2026-01-01T00:00', undefined)

    expect(range.startDate).toEqual(new Date('2026-01-01T00:00'))
    expect(range.endDate.getTime()).toBeCloseTo(Date.now(), -3)
  })

  it('uses both bounds when provided for a custom period', () => {
    const range = resolveDateRange('custom', '2026-01-01T00:00', '2026-01-31T00:00')

    expect(range.startDate).toEqual(new Date('2026-01-01T00:00'))
    expect(range.endDate).toEqual(new Date('2026-01-31T00:00'))
  })

  it('omits startDate for the "all" period', () => {
    const range = resolveDateRange('all', undefined, undefined)

    expect(range.startDate).toBeUndefined()
  })

  it('resolves a startDate N days back for a preset period', () => {
    const range = resolveDateRange('7d', undefined, undefined)

    const expected = new Date()
    expected.setDate(expected.getDate() - 7)
    expect(range.startDate?.toDateString()).toBe(expected.toDateString())
  })
})
