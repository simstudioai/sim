/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCloudWatchClient: vi.fn(),
  createCloudWatchLogsClient: vi.fn(),
  describeLogStreams: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/cloudwatch/client', () => ({
  createCloudWatchClient: mocks.createCloudWatchClient,
  createCloudWatchLogsClient: mocks.createCloudWatchLogsClient,
  describeLogStreams: mocks.describeLogStreams,
  filterLogEvents: vi.fn(),
  getLogEvents: vi.fn(),
  pollQueryResults: vi.fn(),
}))

import {
  CloudWatchInputError,
  executeCloudwatchDescribeLogGroups,
  executeCloudwatchDescribeLogStreams,
  executeCloudwatchGetMetricStatistics,
  executeCloudwatchListMetrics,
} from '@/lib/internal/cloudwatch/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('CloudWatch operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCloudWatchClient.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
    mocks.createCloudWatchLogsClient.mockReturnValue({
      send: mocks.send,
      destroy: mocks.destroy,
    })
  })

  it('uses the shared bounded listing primitive for log groups', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({
      logGroups: [
        {
          logGroupName: '/aws/lambda/example',
          arn: 'arn:aws:logs:us-east-1:123:log-group:/aws/lambda/example',
          storedBytes: 1,
        },
      ],
    })

    await expect(
      executeCloudwatchDescribeLogGroups({ ...CONNECTION, prefix: '/aws' }, controller.signal)
    ).resolves.toEqual({
      success: true,
      output: {
        logGroups: [
          {
            logGroupName: '/aws/lambda/example',
            arn: 'arn:aws:logs:us-east-1:123:log-group:/aws/lambda/example',
            storedBytes: 1,
            retentionInDays: undefined,
            creationTime: undefined,
          },
        ],
      },
    })

    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('uses the shared bounded listing primitive for log streams', async () => {
    const controller = new AbortController()
    mocks.describeLogStreams.mockResolvedValue({
      logStreams: [
        {
          logStreamName: 'stream',
          lastEventTimestamp: undefined,
          firstEventTimestamp: undefined,
          creationTime: undefined,
          storedBytes: 0,
        },
      ],
    })

    await expect(
      executeCloudwatchDescribeLogStreams(
        { ...CONNECTION, logGroupName: '/aws/lambda/example' },
        controller.signal
      )
    ).resolves.toEqual({
      success: true,
      output: {
        logStreams: [
          {
            logStreamName: 'stream',
            lastEventTimestamp: undefined,
            firstEventTimestamp: undefined,
            creationTime: undefined,
            storedBytes: 0,
          },
        ],
      },
    })

    expect(mocks.describeLogStreams).toHaveBeenCalledWith(
      expect.anything(),
      '/aws/lambda/example',
      { prefix: undefined, limit: undefined },
      controller.signal
    )
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('forwards cancellation across paginated metric requests and destroys the client', async () => {
    const controller = new AbortController()
    mocks.send
      .mockResolvedValueOnce({
        Metrics: [{ Namespace: 'Sim/Test', MetricName: 'Requests', Dimensions: [] }],
        NextToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Metrics: [{ Namespace: 'Sim/Test', MetricName: 'Errors', Dimensions: [] }],
      })

    await expect(executeCloudwatchListMetrics(CONNECTION, controller.signal)).resolves.toEqual({
      success: true,
      output: {
        metrics: [
          { namespace: 'Sim/Test', metricName: 'Requests', dimensions: [] },
          { namespace: 'Sim/Test', metricName: 'Errors', dimensions: [] },
        ],
      },
    })
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.send.mock.calls[1]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the client when provider execution fails', async () => {
    mocks.send.mockRejectedValue(new Error('provider failure'))

    await expect(executeCloudwatchListMetrics(CONNECTION)).rejects.toThrow('provider failure')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('rejects invalid metric dimensions before creating a client', async () => {
    await expect(
      executeCloudwatchGetMetricStatistics({
        ...CONNECTION,
        namespace: 'Sim/Test',
        metricName: 'Requests',
        startTime: 1,
        endTime: 2,
        period: 60,
        statistics: ['Average'],
        dimensions: '{invalid',
      })
    ).rejects.toBeInstanceOf(CloudWatchInputError)
    expect(mocks.createCloudWatchClient).not.toHaveBeenCalled()
  })
})
