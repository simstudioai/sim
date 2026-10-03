import { describe, expect, it } from 'vitest'
import { organizationUsageEventsQuerySchema } from '@/lib/api/contracts/organization-usage'

/** The shared window fields every usage contract extends, exercised through one of them. */
function parseWindow(input: Record<string, unknown>) {
  return organizationUsageEventsQuerySchema.safeParse({ preset: 'custom', ...input })
}

describe('organization usage window contract', () => {
  it('refuses a date that does not exist', () => {
    // `Date.parse` accepts this and rolls it forward to March 2, so a request for
    // February would otherwise be answered about March without saying so.
    expect(parseWindow({ startDate: '2026-02-30' }).success).toBe(false)
  })

  /**
   * Out of calendar range but well-formed enough to reach the old hand-rolled refinement, which
   * called `toISOString` on an Invalid Date. Zod does not wrap refinements, so the RangeError
   * escaped `safeParse` itself and every usage route answered a malformed query string with a 500.
   */
  it.each(['2026-13-01', '9999-99-99'])(
    'refuses %s without throwing out of safeParse',
    (startDate) => {
      expect(parseWindow({ startDate }).success).toBe(false)
    }
  )

  it('refuses February 29 in a non-leap year', () => {
    expect(parseWindow({ startDate: '2026-02-29' }).success).toBe(false)
    expect(parseWindow({ startDate: '2024-02-29' }).success).toBe(true)
  })

  it('refuses a parseable non-date such as a bare month', () => {
    // `new Date('2026-08')` is August 1. Accepting it returned a window the caller
    // never asked for, with nothing to indicate the value had been reinterpreted.
    expect(parseWindow({ startDate: '2026-08' }).success).toBe(false)
  })

  it('refuses anything after the date, including a well-formed datetime', () => {
    // The picker sends bare dates only, and every looser rule broke differently:
    // `…Tgarbage` parsed to an Invalid Date that made the resolver throw from
    // `toISOString` (a 500 for a bad query string), and an offset datetime validated
    // on its date part while the resolver read a different UTC day off the whole
    // value — so the range shown and the range queried disagreed.
    expect(parseWindow({ startDate: '2026-08-01Tgarbage' }).success).toBe(false)
    expect(parseWindow({ startDate: '2026-08-01T00:00:00+05:00' }).success).toBe(false)
    expect(parseWindow({ startDate: '2026-02-30T00:00:00' }).success).toBe(false)
  })

  it('refuses an empty date but allows an absent one', () => {
    // The picker clears the param rather than blanking it, so `?start-date=` is a
    // malformed request — and treating it as absent silently answered about the
    // current period instead of the range the caller named.
    expect(parseWindow({ startDate: '' }).success).toBe(false)
    expect(parseWindow({}).success).toBe(true)
  })

  it('refuses a timezone the runtime does not recognize', () => {
    expect(parseWindow({ timezone: 'Mars/Olympus_Mons' }).success).toBe(false)
  })
})
