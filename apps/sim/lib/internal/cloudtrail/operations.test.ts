/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCloudTrailClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/cloudtrail/client', () => ({
  createCloudTrailClient: mocks.createCloudTrailClient,
}))

import {
  executeCloudtrailCancelQuery,
  executeCloudtrailDescribeTrails,
  executeCloudtrailGetQueryResults,
  executeCloudtrailListTrails,
  executeCloudtrailLookupEvents,
} from '@/lib/internal/cloudtrail/operations'

const CONNECTION = {
  region: 'eu-west-2',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('CloudTrail operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCloudTrailClient.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
  })

  it('parses CloudTrailEvent into a structured record and forwards cancellation', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({
      Events: [
        {
          EventId: 'event-1',
          EventName: 'ConsoleLogin',
          ReadOnly: 'false',
          AccessKeyId: 'AKIAEXAMPLE',
          EventTime: new Date('2026-09-01T12:00:00.000Z'),
          EventSource: 'signin.amazonaws.com',
          Username: 'alice',
          Resources: [{ ResourceType: 'AWS::S3::Bucket', ResourceName: 'my-bucket' }],
          CloudTrailEvent: JSON.stringify({
            sourceIPAddress: '203.0.113.10',
            userIdentity: { type: 'IAMUser', arn: 'arn:aws:iam::123456789012:user/alice' },
          }),
        },
      ],
      NextToken: 'next-page',
    })

    const result = await executeCloudtrailLookupEvents(
      { ...CONNECTION, attributeKey: 'Username', attributeValue: 'alice', maxResults: 10 },
      controller.signal
    )

    const [command, options] = mocks.send.mock.calls[0]
    expect(command.input).toEqual({
      LookupAttributes: [{ AttributeKey: 'Username', AttributeValue: 'alice' }],
      MaxResults: 10,
    })
    expect(options).toEqual({ abortSignal: controller.signal })

    expect(result.output.events[0].cloudTrailEvent).toEqual({
      sourceIPAddress: '203.0.113.10',
      userIdentity: { type: 'IAMUser', arn: 'arn:aws:iam::123456789012:user/alice' },
    })
    expect(result.output.events[0].cloudTrailEventRaw).toBeNull()
    expect(result.output.events[0].eventTime).toBe('2026-09-01T12:00:00.000Z')
    expect(result.output.nextToken).toBe('next-page')
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('preserves an unparseable CloudTrailEvent as the raw string rather than dropping it', async () => {
    mocks.send.mockResolvedValue({ Events: [{ EventId: 'event-1', CloudTrailEvent: 'not json' }] })

    const result = await executeCloudtrailLookupEvents(CONNECTION)

    expect(result.output.events[0].cloudTrailEvent).toBeNull()
    expect(result.output.events[0].cloudTrailEventRaw).toBe('not json')
  })

  it('uses adaptive retry only for the throttle-limited lookup operation', async () => {
    mocks.send.mockResolvedValue({ Trails: [] })
    await executeCloudtrailListTrails(CONNECTION)
    expect(mocks.createCloudTrailClient).toHaveBeenLastCalledWith(
      expect.objectContaining(CONNECTION),
      undefined
    )

    mocks.send.mockResolvedValue({ Events: [] })
    await executeCloudtrailLookupEvents(CONNECTION)
    expect(mocks.createCloudTrailClient).toHaveBeenLastCalledWith(
      expect.objectContaining(CONNECTION),
      { throttleSensitive: true }
    )
  })

  it('threads the caller region through without overriding it', async () => {
    mocks.send.mockResolvedValue({ Trails: [] })

    await executeCloudtrailListTrails({ ...CONNECTION, region: 'us-gov-west-1' })

    expect(mocks.createCloudTrailClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-gov-west-1' }),
      undefined
    )
  })

  it('omits includeShadowTrails when unset so the AWS default applies', async () => {
    mocks.send.mockResolvedValue({ trailList: [] })

    await executeCloudtrailDescribeTrails(CONNECTION)

    expect(mocks.send.mock.calls[0][0].input).toEqual({})
  })

  it('flattens Lake result rows into one object per row', async () => {
    mocks.send.mockResolvedValue({
      QueryStatus: 'FINISHED',
      QueryResultRows: [
        [{ eventName: 'ConsoleLogin' }, { eventCount: '12' }],
        [{ eventName: 'AssumeRole' }, { eventCount: '4' }],
      ],
      QueryStatistics: { ResultsCount: 2, TotalResultsCount: 2, BytesScanned: 1024 },
      NextToken: 'next-page',
    })

    const result = await executeCloudtrailGetQueryResults({
      ...CONNECTION,
      queryId: '11111111-2222-3333-4444-555555555555',
      maxQueryResults: 2,
    })

    expect(result.output.rows).toEqual([
      { eventName: 'ConsoleLogin', eventCount: '12' },
      { eventName: 'AssumeRole', eventCount: '4' },
    ])
    expect(result.output.totalResultsCount).toBe(2)
    expect(result.output.nextToken).toBe('next-page')
  })

  it('reports the status AWS returned for a cancellation without inventing a terminal state', async () => {
    mocks.send.mockResolvedValue({ QueryId: 'query-1' })

    const result = await executeCloudtrailCancelQuery({
      ...CONNECTION,
      queryId: '11111111-2222-3333-4444-555555555555',
    })

    expect(result.output.queryStatus).toBeNull()
    expect(result.output.queryId).toBe('query-1')
  })

  it('destroys the client when the AWS call throws', async () => {
    mocks.send.mockRejectedValue(new Error('ThrottlingException'))

    await expect(executeCloudtrailLookupEvents(CONNECTION)).rejects.toThrow('ThrottlingException')
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })
})
