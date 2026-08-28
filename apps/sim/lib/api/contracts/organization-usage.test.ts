/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { organizationUsageEventsQuerySchema } from '@/lib/api/contracts/organization-usage'

/** The shared window fields every usage contract extends, exercised through one of them. */
function parseWindow(input: Record<string, unknown>) {
  return organizationUsageEventsQuerySchema.safeParse({ preset: 'custom', ...input })
}

describe('organization usage window contract', () => {
  it('accepts a real calendar date', () => {
    expect(parseWindow({ startDate: '2026-08-01', endDate: '2026-08-31' }).success).toBe(true)
  })

  it('refuses a date that does not exist', () => {
    // `Date.parse` accepts this and rolls it forward to March 2, so a request for
    // February would otherwise be answered about March without saying so.
    expect(parseWindow({ startDate: '2026-02-30' }).success).toBe(false)
  })

  it('refuses a nonexistent day inside a datetime, not just a bare date', () => {
    expect(parseWindow({ startDate: '2026-02-30T00:00:00' }).success).toBe(false)
  })

  it('refuses a parseable non-date such as a bare month', () => {
    // `new Date('2026-08')` is August 1. Accepting it returned a window the caller
    // never asked for, with nothing to indicate the value had been reinterpreted.
    expect(parseWindow({ startDate: '2026-08' }).success).toBe(false)
  })

  it('treats an empty limit as omitted rather than as zero', () => {
    // `z.coerce.number()` turns `''` into `0`, which then fails `.min(1)` — so a
    // client serializing an unset filter got a 400 instead of the declared default.
    const parsed = parseWindow({ limit: '' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.limit).toBe(50)
  })

  it('normalizes a single source to a one-item array', () => {
    // One selected filter arrives as a scalar, which a bare `z.array` rejected.
    const parsed = parseWindow({ source: 'workflow' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.source).toEqual(['workflow'])
  })

  it('refuses an unknown source instead of matching nothing', () => {
    expect(parseWindow({ source: 'not-a-source' }).success).toBe(false)
  })

  it('refuses a timezone the runtime does not recognize', () => {
    expect(parseWindow({ timezone: 'Mars/Olympus_Mons' }).success).toBe(false)
  })
})
