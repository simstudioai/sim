/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatchSimEvent, mockReadLastFiredAt, mockClaimCooldown } = vi.hoisted(() => ({
  mockDispatchSimEvent: vi.fn(),
  mockReadLastFiredAt: vi.fn(),
  mockClaimCooldown: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/workspace-events/emitter', () => ({
  dispatchSimEvent: mockDispatchSimEvent,
}))

vi.mock('@/lib/workspace-events/state', () => ({
  readLastFiredAt: mockReadLastFiredAt,
  claimCooldown: mockClaimCooldown,
  isWithinCooldown: vi.fn(
    (lastFiredAt: Date | null, cooldownMs: number) =>
      lastFiredAt !== null && Date.now() - lastFiredAt.getTime() < cooldownMs
  ),
}))

vi.mock('@/lib/workspace-events/subscriptions', () => ({
  parseSubscriptionConfig: vi.fn((providerConfig: unknown) => providerConfig),
}))

vi.mock('@/lib/workspace-events/rules', () => ({
  excludeSimExecutionsCondition: vi.fn(() => ({ type: 'ne', right: 'sim' })),
}))

import { pollNoActivityEvents } from '@/lib/workspace-events/no-activity'
import type { SimSubscriptionConfig } from '@/lib/workspace-events/types'

function makeConfig(overrides: Partial<SimSubscriptionConfig> = {}): SimSubscriptionConfig {
  return {
    eventType: 'no_activity',
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

function makeSubscriptionRow(config: SimSubscriptionConfig) {
  return {
    webhook: {
      id: 'wh-1',
      workflowId: 'wf-subscriber',
      blockId: 'block-1',
      path: 'block-1',
      provider: 'sim',
      providerConfig: config,
      isActive: true,
    },
    workflow: {
      id: 'wf-subscriber',
      name: 'Subscriber',
      workspaceId: 'ws-1',
    },
  }
}

describe('pollNoActivityEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadLastFiredAt.mockResolvedValue(null)
    mockClaimCooldown.mockResolvedValue(true)
    mockDispatchSimEvent.mockResolvedValue(undefined)
  })

  it('does nothing when there are no no_activity subscriptions', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result).toEqual({ subscriptions: 0, checked: 0, fired: 0, skipped: 0 })
    expect(mockDispatchSimEvent).not.toHaveBeenCalled()
  })

  it('fires for a watched workflow with no executions in the window', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce([{ id: 'wf-quiet', name: 'Quiet Workflow' }])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.fired).toBe(1)
    expect(mockClaimCooldown).toHaveBeenCalledWith(
      'wf-subscriber',
      'block-1',
      'wf-quiet',
      expect.any(Number)
    )
    expect(mockDispatchSimEvent).toHaveBeenCalledTimes(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({
      event: 'no_activity',
      workflowId: 'wf-quiet',
      workflowName: 'Quiet Workflow',
      runId: null,
    })
  })

  it('does not fire for a workflow with recent activity', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce([{ id: 'wf-busy', name: 'Busy Workflow' }])
      .mockResolvedValueOnce([{ id: 'log-1' }])

    const result = await pollNoActivityEvents()

    expect(result.fired).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockDispatchSimEvent).not.toHaveBeenCalled()
  })

  it('only fires for the inactive workflow when watching several', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce([
        { id: 'wf-busy', name: 'Busy Workflow' },
        { id: 'wf-quiet', name: 'Quiet Workflow' },
      ])
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.fired).toBe(1)
    expect(mockDispatchSimEvent).toHaveBeenCalledTimes(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-quiet' })
  })

  it('cooldown is scoped per watched workflow: a cooled-down workflow does not suppress others', async () => {
    mockReadLastFiredAt.mockImplementation((_wf: string, _block: string, scopeKey: string) =>
      Promise.resolve(scopeKey === 'wf-cooled' ? new Date() : null)
    )
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce([
        { id: 'wf-cooled', name: 'Cooled Workflow' },
        { id: 'wf-quiet', name: 'Quiet Workflow' },
      ])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.fired).toBe(1)
    expect(result.skipped).toBe(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-quiet' })
  })

  it('a never-executed workflow fires once, then the lost claim suppresses repeats', async () => {
    mockClaimCooldown.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    for (let poll = 0; poll < 2; poll++) {
      dbChainMockFns.limit
        .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
        .mockResolvedValueOnce([{ id: 'wf-never-ran', name: 'Never Ran' }])
        .mockResolvedValueOnce([])
    }

    const first = await pollNoActivityEvents()
    const second = await pollNoActivityEvents()

    expect(first.fired).toBe(1)
    expect(second.fired).toBe(0)
    expect(mockDispatchSimEvent).toHaveBeenCalledTimes(1)
  })

  it('respects the explicit workflow selection when one is set', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig({ workflowIds: ['wf-watched'] }))])
      .mockResolvedValueOnce([
        { id: 'wf-watched', name: 'Watched' },
        { id: 'wf-unwatched', name: 'Unwatched' },
      ])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.checked).toBe(1)
    expect(mockDispatchSimEvent).toHaveBeenCalledTimes(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-watched' })
  })

  it('never checks the subscriber workflow itself', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce([{ id: 'wf-subscriber', name: 'Subscriber' }])

    const result = await pollNoActivityEvents()

    expect(result.checked).toBe(0)
    expect(mockDispatchSimEvent).not.toHaveBeenCalled()
  })
})
