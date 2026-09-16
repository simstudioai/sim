import { describe, expect, it } from 'vitest'
import { organizationActivityBreakdownQuerySchema } from '@/lib/api/contracts/organization-activity'

describe('activity query boundaries', () => {
  it.each([
    { dimension: 'transcripts' },
    { sort: 'arbitrary sql' },
    { page: -1 },
    { page: 1001 },
    { page: 1.5 },
    { timezone: 'invalid' },
    { startDate: '2026-02-30' },
    { endDate: '2026-08-01T23:59:59Z' },
  ])('rejects unsupported dimensions, orders, pages and dates: %j', (query) => {
    expect(organizationActivityBreakdownQuerySchema.safeParse(query).success).toBe(false)
  })

  it('parses bounded URL parameters into the shared query', () => {
    expect(
      organizationActivityBreakdownQuerySchema.parse({ page: '2', dimension: 'workflow' })
    ).toMatchObject({
      page: 2,
      dimension: 'workflow',
      sort: 'runs',
      preset: 'current-period',
      timezone: 'UTC',
    })
  })
})
