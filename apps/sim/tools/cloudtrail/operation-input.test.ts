/**
 * @vitest-environment node
 *
 * The CloudTrail block collects `trailNameList`, `resourceIdList`, and `queryParameters` as
 * comma-separated strings, while their contracts require arrays. `operation.input` is the seam
 * that converts them, and it runs before contract validation, so these fields must arrive at the
 * contract already split. Regressing this would 400 every request that uses them.
 */
import { describe, expect, it } from 'vitest'
import { describeTrailsTool } from '@/tools/cloudtrail/describe_trails'
import { listTagsTool } from '@/tools/cloudtrail/list_tags'
import { startQueryTool } from '@/tools/cloudtrail/start_query'

const CONNECTION = {
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  awsSecretAccessKey: 'secret',
}

const TRAIL_ARN = 'arn:aws:cloudtrail:us-east-1:123456789012:trail/audit-trail'

describe('cloudtrail operation input', () => {
  it('splits comma-separated trail names for describe_trails', () => {
    const input = describeTrailsTool.operation.input({
      ...CONNECTION,
      trailNameList: 'audit-trail, security-trail',
    })

    expect(input.trailNameList).toEqual(['audit-trail', 'security-trail'])
  })

  it('omits trailNameList entirely when it is blank', () => {
    const input = describeTrailsTool.operation.input({ ...CONNECTION, trailNameList: '  ' })

    expect(input.trailNameList).toBeUndefined()
  })

  it('splits comma-separated resource ARNs for list_tags', () => {
    const input = listTagsTool.operation.input({
      ...CONNECTION,
      resourceIdList: `${TRAIL_ARN},${TRAIL_ARN}`,
    })

    expect(input.resourceIdList).toEqual([TRAIL_ARN, TRAIL_ARN])
  })

  it('splits comma-separated query template parameters for start_query', () => {
    const input = startQueryTool.operation.input({
      ...CONNECTION,
      queryAlias: 'top-errors',
      queryParameters: 'us-east-1, 2026-01-01',
    })

    expect(input.queryParameters).toEqual(['us-east-1', '2026-01-01'])
  })

  it('preserves empty positional slots in start_query query parameters', () => {
    const input = startQueryTool.operation.input({
      ...CONNECTION,
      queryAlias: 'top-errors',
      queryParameters: 'us-east-1,,2026-01-01',
    })

    expect(input.queryParameters).toEqual(['us-east-1', '', '2026-01-01'])
  })

  it('omits queryParameters entirely when it is blank', () => {
    const input = startQueryTool.operation.input({
      ...CONNECTION,
      queryAlias: 'top-errors',
      queryParameters: '   ',
    })

    expect(input.queryParameters).toBeUndefined()
  })
})
