/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => {
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
  return { mockSend: vi.fn() }
})

vi.mock('@aws-sdk/client-cloudwatch', () => {
  class MockCloudWatchClient {
    send = mockSend
  }
  class MockPutMetricDataCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  return {
    CloudWatchClient: MockCloudWatchClient,
    PutMetricDataCommand: MockPutMetricDataCommand,
    StandardUnit: { Count: 'Count', Milliseconds: 'Milliseconds', None: 'None' },
  }
})

import { flushMetrics, hostedKeyMetrics, workflowMetrics } from '@/lib/monitoring/metrics'

interface SentCommand {
  input: { Namespace: string; MetricData: Array<Record<string, any>> }
}

function sentCommands(): SentCommand['input'][] {
  return mockSend.mock.calls.map(([cmd]) => (cmd as SentCommand).input)
}

function findDatum(namespace: string, metricName: string) {
  const batch = sentCommands().find((c) => c.Namespace === namespace)
  return batch?.MetricData.find((d) => d.MetricName === metricName)
}

describe('CloudWatch metrics emitter', () => {
  beforeEach(async () => {
    await flushMetrics()
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
  })

  it('groups buffered points into one PutMetricData call per namespace', async () => {
    hostedKeyMetrics.recordUsed({ provider: 'openai', tool: 'gpt', key: 'OPENAI_API_KEY' })
    workflowMetrics.recordExecutionStarted({ trigger: 'api' })

    await flushMetrics()

    const namespaces = sentCommands().map((c) => c.Namespace)
    expect(namespaces).toHaveLength(2)
    expect(namespaces).toContain('Sim/HostedKey')
    expect(namespaces).toContain('Sim/Workflow')
  })

  it('drains the buffer so a second flush sends nothing', async () => {
    workflowMetrics.recordExecutionStarted({ trigger: 'manual' })

    await flushMetrics()
    await flushMetrics()

    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('emits ExecutionCompleted with Trigger and Status dimensions plus duration', async () => {
    workflowMetrics.recordExecutionCompleted({
      trigger: 'webhook',
      status: 'failed',
      durationMs: 1234,
    })

    await flushMetrics()

    const completed = findDatum('Sim/Workflow', 'ExecutionCompleted')
    expect(completed).toMatchObject({ Value: 1, Unit: 'Count' })
    expect(completed?.Dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Name: 'Environment' }),
        { Name: 'Trigger', Value: 'webhook' },
        { Name: 'Status', Value: 'failed' },
      ])
    )

    const duration = findDatum('Sim/Workflow', 'ExecutionDuration')
    expect(duration).toMatchObject({ Value: 1234, Unit: 'Milliseconds' })
  })

  it('skips ExecutionDuration when durationMs is unknown', async () => {
    workflowMetrics.recordExecutionCompleted({ trigger: 'schedule', status: 'failed' })

    await flushMetrics()

    expect(findDatum('Sim/Workflow', 'ExecutionCompleted')).toBeDefined()
    expect(findDatum('Sim/Workflow', 'ExecutionDuration')).toBeUndefined()
  })

  it('emits BlockExecuted with BlockType/Operation/Success and BlockDuration without Operation', async () => {
    workflowMetrics.recordBlockExecuted({
      blockType: 'cloudwatch',
      operation: 'put_metric_data',
      success: false,
      durationMs: 42,
    })

    await flushMetrics()

    const executed = findDatum('Sim/Workflow', 'BlockExecuted')
    expect(executed?.Dimensions).toEqual(
      expect.arrayContaining([
        { Name: 'BlockType', Value: 'cloudwatch' },
        { Name: 'Operation', Value: 'put_metric_data' },
        { Name: 'Success', Value: 'false' },
      ])
    )

    const duration = findDatum('Sim/Workflow', 'BlockDuration')
    expect(duration).toMatchObject({ Value: 42, Unit: 'Milliseconds' })
    expect(duration?.Dimensions).toEqual([
      expect.objectContaining({ Name: 'Environment' }),
      { Name: 'BlockType', Value: 'cloudwatch' },
    ])
  })

  it('omits the Operation dimension when not provided', async () => {
    workflowMetrics.recordBlockExecuted({ blockType: 'agent', success: true, durationMs: 5 })

    await flushMetrics()

    const executed = findDatum('Sim/Workflow', 'BlockExecuted')
    expect(executed?.Dimensions?.map((d: { Name: string }) => d.Name)).not.toContain('Operation')
  })

  it('drops the batch instead of throwing when PutMetricData fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('cloudwatch down'))
    workflowMetrics.recordExecutionStarted({ trigger: 'chat' })

    await expect(flushMetrics()).resolves.toBeUndefined()

    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
    await flushMetrics()
    expect(mockSend).not.toHaveBeenCalled()
  })
})
