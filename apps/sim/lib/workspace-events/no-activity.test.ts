/**
 * @vitest-environment node
 */
import { dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatchSimEvent, mockReadLastFiredAt, mockClaimCooldown } = vi.hoisted(() => ({
  mockDispatchSimEvent: vi.fn(),
  mockReadLastFiredAt: vi.fn(),
  mockClaimCooldown: vi.fn(),
}))

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

import {
  NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE,
  NO_ACTIVITY_WORKFLOW_PAGE_SIZE,
  pollNoActivityEvents,
} from '@/lib/workspace-events/no-activity'
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

/** Flattens nested and/or condition trees from the drizzle operator mocks. */
function flattenCondition(condition: unknown): unknown[] {
  if (!condition || typeof condition !== 'object') return []
  const node = condition as { type?: string; conditions?: unknown[] }
  if (node.type === 'and' || node.type === 'or') {
    return [node, ...(node.conditions ?? []).flatMap(flattenCondition)]
  }
  return [node]
}

function allWhereConditions(): unknown[] {
  return dbChainMockFns.where.mock.calls.flatMap(([condition]) => flattenCondition(condition))
}

function makeSubscriptionRow(config: SimSubscriptionConfig, webhookId = 'wh-1') {
  return {
    webhook: {
      id: webhookId,
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

  it('scopes the watched-workflow query to the explicit selection in SQL (before the LIMIT)', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig({ workflowIds: ['wf-watched'] }))])
      .mockResolvedValueOnce([{ id: 'wf-watched', name: 'Watched' }])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.checked).toBe(1)
    expect(mockDispatchSimEvent).toHaveBeenCalledTimes(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-watched' })
    expect(allWhereConditions()).toContainEqual(
      expect.objectContaining({ type: 'inArray', values: ['wf-watched'] })
    )
  })

  it('pages through subscriptions past the page size with a keyset cursor (no starvation)', async () => {
    // Full first page of non-matching subscriptions (skipped without further
    // queries), then a second page holding the one real no_activity
    // subscription that must still be reached.
    const firstPage = Array.from({ length: NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE }, (_, i) =>
      makeSubscriptionRow(makeConfig({ eventType: 'execution_error' }), `wh-page1-${i}`)
    )
    dbChainMockFns.limit
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig(), 'wh-page2-0')])
      .mockResolvedValueOnce([{ id: 'wf-quiet', name: 'Quiet Workflow' }])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.subscriptions).toBe(NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE + 1)
    expect(result.fired).toBe(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-quiet' })
    expect(allWhereConditions()).toContainEqual(
      expect.objectContaining({
        type: 'gt',
        right: `wh-page1-${NO_ACTIVITY_SUBSCRIPTION_PAGE_SIZE - 1}`,
      })
    )
  })

  it('pages through watched workflows past the page size with a keyset cursor (no lost coverage)', async () => {
    // Full first page of watched workflows all inside their cooldown (skipped
    // without activity queries), then a second page holding the quiet
    // workflow that must still be reached.
    mockReadLastFiredAt.mockImplementation((_wf: string, _block: string, scopeKey: string) =>
      Promise.resolve(scopeKey.startsWith('wf-p1-') ? new Date() : null)
    )
    const firstPage = Array.from({ length: NO_ACTIVITY_WORKFLOW_PAGE_SIZE }, (_, i) => ({
      id: `wf-p1-${i}`,
      name: `Workflow ${i}`,
    }))
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 'wf-quiet', name: 'Quiet Workflow' }])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.checked).toBe(NO_ACTIVITY_WORKFLOW_PAGE_SIZE + 1)
    expect(result.skipped).toBe(NO_ACTIVITY_WORKFLOW_PAGE_SIZE)
    expect(result.fired).toBe(1)
    expect(mockDispatchSimEvent.mock.calls[0][1]).toMatchObject({ workflowId: 'wf-quiet' })
    expect(allWhereConditions()).toContainEqual(
      expect.objectContaining({
        type: 'gt',
        right: `wf-p1-${NO_ACTIVITY_WORKFLOW_PAGE_SIZE - 1}`,
      })
    )
  })

  it('excludes the subscriber workflow in SQL (before the LIMIT)', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([makeSubscriptionRow(makeConfig())])
      .mockResolvedValueOnce([])

    const result = await pollNoActivityEvents()

    expect(result.checked).toBe(0)
    expect(mockDispatchSimEvent).not.toHaveBeenCalled()
    expect(allWhereConditions()).toContainEqual(
      expect.objectContaining({ type: 'ne', right: 'wf-subscriber' })
    )
  })
})
