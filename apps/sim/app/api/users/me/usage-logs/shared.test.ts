import { describe, expect, it } from 'vitest'
import { resolveDateRange } from '@/app/api/users/me/usage-logs/shared'

describe('resolveDateRange', () => {
  it('throws when period is "custom" without a startDate', () => {
    expect(() => resolveDateRange('custom', undefined, undefined)).toThrow(
      'startDate is required when period is "custom"'
    )
  })

  it('resolves a startDate N days back for a preset period', () => {
    const range = resolveDateRange('7d', undefined, undefined)

    const expected = new Date()
    expected.setDate(expected.getDate() - 7)
    expect(range.startDate?.toDateString()).toBe(expected.toDateString())
  })
})
