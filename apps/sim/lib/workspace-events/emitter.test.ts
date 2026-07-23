/**
 * @vitest-environment node
 */
import { workflowAuthzMockFns } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetActiveWorkflowContext } = workflowAuthzMockFns

afterAll(() => {
  mockGetActiveWorkflowContext.mockReset()
})

const {
  mockFetchSubscriptions,
  mockEvaluateRule,
  mockReadLastFiredAt,
  mockClaimCooldown,
  mockProcessPolledWebhookEvent,
} = vi.hoisted(() => ({
  mockFetchSubscriptions: vi.fn(),
  mockEvaluateRule: vi.fn(),
  mockReadLastFiredAt: vi.fn(),
  mockClaimCooldown: vi.fn(),
  mockProcessPolledWebhookEvent: vi.fn(),
}))

vi.mock('@/lib/workspace-events/subscriptions', () => ({
  fetchSimTriggerSubscriptions: mockFetchSubscriptions,
  parseSubscriptionConfig: vi.fn((providerConfig: unknown) => providerConfig),
}))

vi.mock('@/lib/workspace-events/rules', () => ({
  evaluateRule: mockEvaluateRule,
}))

vi.mock('@/lib/workspace-events/state', () => ({
  readLastFiredAt: mockReadLastFiredAt,
  claimCooldown: mockClaimCooldown,
  isWithinCooldown: vi.fn(
    (lastFiredAt: Date | null, cooldownMs: number) =>
      lastFiredAt !== null && Date.now() - lastFiredAt.getTime() < cooldownMs
  ),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: mockProcessPolledWebhookEvent,
}))

import type { WorkflowExecutionLog } from '@/lib/logs/types'
import {
  emitExecutionCompletedEvent,
  emitWorkflowDeployedEvent,
} from '@/lib/workspace-events/emitter'
import type { SimSubscriptionConfig } from '@/lib/workspace-events/types'

function makeConfig(overrides: Partial<SimSubscriptionConfig> = {}): SimSubscriptionConfig {
  return {
    eventType: 'execution_error',
    workflowIds: [],
    consecutiveFailures: 3,
    failureRatePercent: 50,
    windowHours: 24,
    durationThresholdMs: 30000,
    latencySpikePercent: 100,
    costThresholdCredits: 200,
    errorCountThreshold: 10,
    inactivityHours: 24,
    ...overrides,
  }
}

function makeSubscription(
  config: SimSubscriptionConfig,
  overrides: { subscriberWorkflowId?: string; blockId?: string } = {}
) {
  const subscriberWorkflowId = overrides.subscriberWorkflowId ?? 'wf-subscriber'
  return {
    webhook: {
      id: `wh-${subscriberWorkflowId}`,
      workflowId: subscriberWorkflowId,
      blockId: overrides.blockId ?? 'block-1',
      path: 'block-1',
      provider: 'sim',
      providerConfig: config,
      isActive: true,
    },
    workflow: {
      id: subscriberWorkflowId,
      name: 'Subscriber Workflow',
    },
  }
}

function makeLog(overrides: Partial<WorkflowExecutionLog> = {}): WorkflowExecutionLog {
  return {
    id: 'log-1',
    workflowId: 'wf-source',
    executionId: 'exec-1',
    stateSnapshotId: 'snap-1',
    level: 'error',
    trigger: 'manual',
    startedAt: '2026-06-09T00:00:00.000Z',
    endedAt: '2026-06-09T00:00:01.000Z',
    totalDurationMs: 1000,
    executionData: {
      error: 'boom',
      finalOutput: { result: 42 },
    } as WorkflowExecutionLog['executionData'],
    cost: { total: 0.25 } as WorkflowExecutionLog['cost'],
    createdAt: '2026-06-09T00:00:01.000Z',
    ...overrides,
  }
}

describe('emitExecutionCompletedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetActiveWorkflowContext.mockResolvedValue({
      workflow: { id: 'wf-source', name: 'Source Workflow' },
      workspaceId: 'ws-1',
    })
    mockFetchSubscriptions.mockResolvedValue([])
    mockProcessPolledWebhookEvent.mockResolvedValue({ success: true, executionId: 'exec-2' })
    mockReadLastFiredAt.mockResolvedValue(null)
    mockClaimCooldown.mockResolvedValue(true)
    mockEvaluateRule.mockResolvedValue(true)
  })

  it('never emits for executions started by the sim trigger (loop guard)', async () => {
    await emitExecutionCompletedEvent(makeLog({ trigger: 'sim' }))

    expect(mockGetActiveWorkflowContext).not.toHaveBeenCalled()
    expect(mockFetchSubscriptions).not.toHaveBeenCalled()
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('does nothing without a workflow id or workspace context', async () => {
    await emitExecutionCompletedEvent(makeLog({ workflowId: null }))
    expect(mockFetchSubscriptions).not.toHaveBeenCalled()

    mockGetActiveWorkflowContext.mockResolvedValueOnce(null)
    await emitExecutionCompletedEvent(makeLog())
    expect(mockFetchSubscriptions).not.toHaveBeenCalled()
  })

  it('looks up subscriptions scoped to the source workspace', async () => {
    await emitExecutionCompletedEvent(makeLog())
    expect(mockFetchSubscriptions).toHaveBeenCalledWith('ws-1')
  })

  it('fires execution_error subscribers for error logs but not execution_success ones', async () => {
    const errorSub = makeSubscription(makeConfig({ eventType: 'execution_error' }), {
      subscriberWorkflowId: 'wf-error-sub',
    })
    const successSub = makeSubscription(makeConfig({ eventType: 'execution_success' }), {
      subscriberWorkflowId: 'wf-success-sub',
    })
    mockFetchSubscriptions.mockResolvedValueOnce([errorSub, successSub])

    await emitExecutionCompletedEvent(makeLog({ level: 'error' }))

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledWith(
      errorSub.webhook,
      errorSub.workflow,
      expect.objectContaining({
        event: 'execution_error',
        workflowId: 'wf-source',
        workflowName: 'Source Workflow',
        runId: 'exec-1',
        durationMs: 1000,
        // $0.25 reported as credits (1 credit = $0.005)
        cost: 50,
      }),
      expect.any(String)
    )
  })

  it('fires execution_success subscribers for info logs', async () => {
    const successSub = makeSubscription(makeConfig({ eventType: 'execution_success' }))
    mockFetchSubscriptions.mockResolvedValueOnce([successSub])

    await emitExecutionCompletedEvent(makeLog({ level: 'info' }))

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPolledWebhookEvent.mock.calls[0][2]).toMatchObject({
      event: 'execution_success',
      runId: 'exec-1',
    })
  })

  it('respects the workflow scope filter, ignoring stale workflow ids', async () => {
    const matching = makeSubscription(makeConfig({ workflowIds: ['wf-source', 'wf-deleted'] }), {
      subscriberWorkflowId: 'wf-a',
    })
    const nonMatching = makeSubscription(makeConfig({ workflowIds: ['wf-other', 'wf-deleted'] }), {
      subscriberWorkflowId: 'wf-b',
    })
    mockFetchSubscriptions.mockResolvedValueOnce([matching, nonMatching])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPolledWebhookEvent.mock.calls[0][0]).toBe(matching.webhook)
  })

  it('an empty workflow selection watches every workflow', async () => {
    const watchAll = makeSubscription(makeConfig({ workflowIds: [] }))
    mockFetchSubscriptions.mockResolvedValueOnce([watchAll])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('never fires a subscription for its own workflow, even when watching all workflows', async () => {
    const selfSub = makeSubscription(makeConfig({ workflowIds: [] }), {
      subscriberWorkflowId: 'wf-source',
    })
    mockFetchSubscriptions.mockResolvedValueOnce([selfSub])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('plain events bypass cooldown state entirely', async () => {
    mockFetchSubscriptions.mockResolvedValueOnce([
      makeSubscription(makeConfig({ eventType: 'execution_error' })),
    ])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockReadLastFiredAt).not.toHaveBeenCalled()
    expect(mockClaimCooldown).not.toHaveBeenCalled()
  })

  it('rule events evaluate the rule and claim the cooldown before dispatching', async () => {
    const sub = makeSubscription(makeConfig({ eventType: 'cost_threshold' }))
    mockFetchSubscriptions.mockResolvedValueOnce([sub])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockEvaluateRule).toHaveBeenCalledTimes(1)
    expect(mockClaimCooldown).toHaveBeenCalledWith(
      'wf-subscriber',
      'block-1',
      '',
      expect.any(Number)
    )
    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPolledWebhookEvent.mock.calls[0][2]).toMatchObject({
      event: 'cost_threshold',
      runId: null,
      triggeringRun: { runId: 'exec-1' },
    })
  })

  it('skips no_activity subscriptions before any cooldown read or rule evaluation (poller-owned)', async () => {
    const sub = makeSubscription(makeConfig({ eventType: 'no_activity' }))
    mockFetchSubscriptions.mockResolvedValueOnce([sub])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockReadLastFiredAt).not.toHaveBeenCalled()
    expect(mockEvaluateRule).not.toHaveBeenCalled()
    expect(mockClaimCooldown).not.toHaveBeenCalled()
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('skips rule evaluation while within the cooldown window', async () => {
    mockReadLastFiredAt.mockResolvedValueOnce(new Date())
    mockFetchSubscriptions.mockResolvedValueOnce([
      makeSubscription(makeConfig({ eventType: 'latency_threshold' })),
    ])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockEvaluateRule).not.toHaveBeenCalled()
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('does not dispatch when the rule does not fire', async () => {
    mockEvaluateRule.mockResolvedValueOnce(false)
    mockFetchSubscriptions.mockResolvedValueOnce([
      makeSubscription(makeConfig({ eventType: 'consecutive_failures' })),
    ])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockClaimCooldown).not.toHaveBeenCalled()
    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('does not dispatch when a concurrent emitter wins the cooldown claim', async () => {
    mockClaimCooldown.mockResolvedValueOnce(false)
    mockFetchSubscriptions.mockResolvedValueOnce([
      makeSubscription(makeConfig({ eventType: 'error_count' })),
    ])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('always includes the source execution finalOutput', async () => {
    mockFetchSubscriptions.mockResolvedValueOnce([makeSubscription(makeConfig())])

    await emitExecutionCompletedEvent(makeLog())

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPolledWebhookEvent.mock.calls[0][2]).toMatchObject({
      finalOutput: { result: 42 },
    })
  })

  it('never throws when emission internals fail', async () => {
    mockFetchSubscriptions.mockRejectedValueOnce(new Error('db down'))
    await expect(emitExecutionCompletedEvent(makeLog())).resolves.toBeUndefined()

    mockProcessPolledWebhookEvent.mockRejectedValueOnce(new Error('enqueue failed'))
    mockFetchSubscriptions.mockResolvedValueOnce([makeSubscription(makeConfig())])
    await expect(emitExecutionCompletedEvent(makeLog())).resolves.toBeUndefined()
  })
})

describe('emitWorkflowDeployedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSubscriptions.mockResolvedValue([])
    mockProcessPolledWebhookEvent.mockResolvedValue({ success: true, executionId: 'exec-2' })
  })

  const deployParams = {
    workflowId: 'wf-source',
    workflowName: 'Source Workflow',
    workspaceId: 'ws-1',
    version: 4,
  }

  it('fires only workflow_deployed subscribers on deploys', async () => {
    const deploySub = makeSubscription(makeConfig({ eventType: 'workflow_deployed' }))
    const errorSub = makeSubscription(makeConfig({ eventType: 'execution_error' }), {
      subscriberWorkflowId: 'wf-other',
    })
    mockFetchSubscriptions.mockResolvedValueOnce([deploySub, errorSub])

    await emitWorkflowDeployedEvent(deployParams)

    expect(mockProcessPolledWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessPolledWebhookEvent.mock.calls[0][2]).toMatchObject({
      event: 'workflow_deployed',
      workflowId: 'wf-source',
      workflowName: 'Source Workflow',
      runId: null,
      version: 4,
    })
  })

  it('does not fire a subscription when its own workflow is deployed', async () => {
    const selfSub = makeSubscription(makeConfig({ eventType: 'workflow_deployed' }), {
      subscriberWorkflowId: 'wf-source',
    })
    mockFetchSubscriptions.mockResolvedValueOnce([selfSub])

    await emitWorkflowDeployedEvent(deployParams)

    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('respects the workflow scope filter', async () => {
    const outOfScope = makeSubscription(
      makeConfig({ eventType: 'workflow_deployed', workflowIds: ['wf-x'] })
    )
    mockFetchSubscriptions.mockResolvedValueOnce([outOfScope])

    await emitWorkflowDeployedEvent(deployParams)

    expect(mockProcessPolledWebhookEvent).not.toHaveBeenCalled()
  })

  it('never throws when emission internals fail', async () => {
    mockFetchSubscriptions.mockRejectedValueOnce(new Error('db down'))
    await expect(emitWorkflowDeployedEvent(deployParams)).resolves.toBeUndefined()
  })
})
