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
})
