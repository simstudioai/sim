import { describe, expect, it } from 'vitest'
import { v2BillingLogsQuerySchema } from '@/lib/api/contracts/v2/billing'

function issuesFor(query: Record<string, unknown>): string[] {
  const parsed = v2BillingLogsQuerySchema.safeParse(query)
  if (parsed.success) return []
  return parsed.error.issues.map((issue) => issue.message)
}

describe('v2 billing logs query schema', () => {
  /**
   * The ordering rule is a question about two instants. A bound that is not a
   * timestamp at all parses to `NaN`, which compares false against everything,
   * so the caller used to be told its window was inverted on top of the issue
   * naming the value it actually has to fix.
   */
  it('does not add an ordering issue to a bound that is not a timestamp', () => {
    const messages = issuesFor({
      period: 'custom',
      startDate: 'not-a-date',
      endDate: '2026-08-01T00:00:00Z',
    })

    expect(messages).not.toContain('startDate must be before or equal to endDate')
    expect(messages.some((message) => message.includes('UTC ISO 8601'))).toBe(true)
  })

  /**
   * `Date.parse` is wider than the bound schema: it happily reads a UTC offset
   * instead of `Z`, and year `0000`. Such a bound is rejected by its own format
   * check yet still yields a number, so the ordering rule has to gate on the
   * bound schema rather than on parseability.
   */
  it('does not add an ordering issue to a bound rejected for a UTC offset instead of Z', () => {
    const messages = issuesFor({
      period: 'custom',
      startDate: '2026-08-06T00:00:00Z',
      endDate: '2026-08-01T00:00:00+02:00',
    })

    expect(messages).not.toContain('startDate must be before or equal to endDate')
    expect(messages).not.toEqual([])
  })

  it('still rejects an inverted window whose bounds are both real instants', () => {
    expect(
      issuesFor({
        period: 'custom',
        startDate: '2026-08-02T00:00:00Z',
        endDate: '2026-08-01T00:00:00Z',
      })
    ).toContain('startDate must be before or equal to endDate')
  })
})
