/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { statsQueryParamsSchema } from '@/lib/api/contracts/logs'
import { v2LogStatsQuerySchema } from '@/lib/api/contracts/v2/logs-stats'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'

/**
 * `segmentCount` reaches the aggregator as an array length and as a divisor, so
 * every value the boundary lets through has to be a whole number inside the
 * cap. Each case below produced a 500 before the bounds landed: `0` divided by
 * zero, `1e9` allocated two billion-element arrays, and a fractional value
 * indexed between buckets.
 */
describe.each([
  ['the public contract', v2LogStatsQuerySchema],
  ['the first-party contract', statsQueryParamsSchema],
])('%s bounds segmentCount', (_label, schema) => {
  it('rejects zero, which would divide by zero deriving the bucket width', () => {
    expect(schema.safeParse({ workspaceId: WORKSPACE_ID, segmentCount: '0' }).success).toBe(false)
  })

  it('rejects a fractional count, which indexes between buckets', () => {
    expect(schema.safeParse({ workspaceId: WORKSPACE_ID, segmentCount: '1.5' }).success).toBe(false)
  })

  it('rejects a count that would allocate unbounded arrays', () => {
    expect(schema.safeParse({ workspaceId: WORKSPACE_ID, segmentCount: '1e9' }).success).toBe(false)
  })

  it('rejects a negative count', () => {
    expect(schema.safeParse({ workspaceId: WORKSPACE_ID, segmentCount: '-1' }).success).toBe(false)
  })

  it('accepts the bounds themselves and defaults when omitted', () => {
    expect(schema.safeParse({ workspaceId: WORKSPACE_ID, segmentCount: '1' }).success).toBe(true)
    expect(schema.safeParse({ workspaceId: WORKSPACE_ID, segmentCount: '500' }).success).toBe(true)

    const defaulted = schema.parse({ workspaceId: WORKSPACE_ID })
    expect(defaulted.segmentCount).toBe(72)
  })
})

describe('v2LogStatsQuerySchema', () => {
  it('names the failing field and the bound', () => {
    const parsed = v2LogStatsQuerySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      segmentCount: '501',
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toBe('segmentCount cannot exceed 500')
  })

  it('rejects an unknown query param rather than silently dropping it', () => {
    expect(v2LogStatsQuerySchema.safeParse({ workspaceId: WORKSPACE_ID, bogus: '1' }).success).toBe(
      false
    )
  })

  it('rejects an inverted date window instead of answering an empty summary', () => {
    const parsed = v2LogStatsQuerySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      startDate: '2026-02-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toBe('startDate must be before or equal to endDate')
  })

  it('normalizes folder paths and rejects an empty entry', () => {
    expect(
      v2LogStatsQuerySchema.parse({ workspaceId: WORKSPACE_ID, folderPaths: '/prod' }).folderPaths
    ).toBe('/prod')
    expect(
      v2LogStatsQuerySchema.safeParse({ workspaceId: WORKSPACE_ID, folderPaths: '/prod,' }).success
    ).toBe(false)
  })
})
