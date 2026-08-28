/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeCloudwatchDescribeAlarmHistory: vi.fn(),
  executeCloudwatchDescribeAlarms: vi.fn(),
  executeCloudwatchDescribeLogGroups: vi.fn(),
  executeCloudwatchDescribeLogStreams: vi.fn(),
  executeCloudwatchFilterLogEvents: vi.fn(),
  executeCloudwatchGetLogEvents: vi.fn(),
  executeCloudwatchGetMetricStatistics: vi.fn(),
  executeCloudwatchListMetrics: vi.fn(),
  executeCloudwatchMuteAlarm: vi.fn(),
  executeCloudwatchPutLogGroupRetention: vi.fn(),
  executeCloudwatchPutMetricData: vi.fn(),
  executeCloudwatchQueryLogs: vi.fn(),
  executeCloudwatchUnmuteAlarm: vi.fn(),
}))

vi.mock('@/lib/internal/cloudwatch/operations', () => ({
  CloudWatchInputError: class CloudWatchInputError extends Error {
    readonly status = 400
  },
  ...mockOperations,
}))

import { executeCloudwatchTool } from '@/lib/internal/cloudwatch/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'cloudwatch_list_metrics',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  [
    'cloudwatch_describe_alarm_history',
    CONNECTION,
    mockOperations.executeCloudwatchDescribeAlarmHistory,
  ],
  ['cloudwatch_describe_alarms', CONNECTION, mockOperations.executeCloudwatchDescribeAlarms],
  ['cloudwatch_describe_log_groups', CONNECTION, mockOperations.executeCloudwatchDescribeLogGroups],
  [
    'cloudwatch_describe_log_streams',
    { ...CONNECTION, logGroupName: 'group' },
    mockOperations.executeCloudwatchDescribeLogStreams,
  ],
  [
    'cloudwatch_filter_log_events',
    { ...CONNECTION, logGroupName: 'group' },
    mockOperations.executeCloudwatchFilterLogEvents,
  ],
  [
    'cloudwatch_get_log_events',
    { ...CONNECTION, logGroupName: 'group', logStreamName: 'stream' },
    mockOperations.executeCloudwatchGetLogEvents,
  ],
  [
    'cloudwatch_get_metric_statistics',
    {
      ...CONNECTION,
      namespace: 'Sim/Test',
      metricName: 'Requests',
      startTime: 1,
      endTime: 2,
      period: 60,
      statistics: ['Average'],
    },
    mockOperations.executeCloudwatchGetMetricStatistics,
  ],
  ['cloudwatch_list_metrics', CONNECTION, mockOperations.executeCloudwatchListMetrics],
  [
    'cloudwatch_mute_alarm',
    {
      ...CONNECTION,
      muteRuleName: 'maintenance',
      alarmNames: ['alarm-1'],
      durationValue: 1,
      durationUnit: 'hours',
    },
    mockOperations.executeCloudwatchMuteAlarm,
  ],
  [
    'cloudwatch_put_log_group_retention',
    { ...CONNECTION, logGroupName: 'group', retentionInDays: 30 },
    mockOperations.executeCloudwatchPutLogGroupRetention,
  ],
  [
    'cloudwatch_put_metric_data',
    { ...CONNECTION, namespace: 'Sim/Test', metricName: 'Requests', value: 1 },
    mockOperations.executeCloudwatchPutMetricData,
  ],
  [
    'cloudwatch_query_logs',
    {
      ...CONNECTION,
      logGroupNames: ['group'],
      queryString: 'fields @message',
      startTime: 1,
      endTime: 2,
    },
    mockOperations.executeCloudwatchQueryLogs,
  ],
  [
    'cloudwatch_unmute_alarm',
    { ...CONNECTION, muteRuleName: 'maintenance' },
    mockOperations.executeCloudwatchUnmuteAlarm,
  ],
] as const

describe('executeCloudwatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeCloudwatchTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeCloudwatchTool(createRequest({ input: { region: 'invalid' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeCloudwatchListMetrics).not.toHaveBeenCalled()
  })

  it('preserves provider error envelopes', async () => {
    mockOperations.executeCloudwatchListMetrics.mockRejectedValue(new Error('AWS rejected'))

    const response = await executeCloudwatchTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to list CloudWatch metrics: AWS rejected',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeCloudwatchTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeCloudwatchListMetrics).not.toHaveBeenCalled()
  })

  it('rethrows cancellation that arrives while provider work is in flight', async () => {
    const controller = new AbortController()
    mockOperations.executeCloudwatchListMetrics.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw new Error('AWS request failed')
    })

    await expect(
      executeCloudwatchTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
