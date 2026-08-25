/**
 * @vitest-environment node
 */
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

  it('still rejects an inverted window whose bounds are both real instants', () => {
    expect(
      issuesFor({
        period: 'custom',
        startDate: '2026-08-02T00:00:00Z',
        endDate: '2026-08-01T00:00:00Z',
      })
    ).toContain('startDate must be before or equal to endDate')
  })

  it('accepts a window in order', () => {
    expect(
      issuesFor({
        period: 'custom',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-02T00:00:00Z',
      })
    ).toEqual([])
  })
})
