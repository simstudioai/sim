/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingCoreMock } from '@sim/testing/mocks/billing-core.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteRequest } = vi.hoisted(() => ({ mockExecuteRequest: vi.fn() }))

vi.mock('@/providers/registry', () => ({
  getProviderExecutor: async () => ({ executeRequest: mockExecuteRequest }),
}))
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/providers/cost-policy', () => ({
  resolveModelCostPolicy: (_model: string, isBYOK = false) => ({
    billable: !isBYOK,
    multiplier: 1,
  }),
  priceModelUsage: (
    _model: string,
    usage: { input: number; output: number },
    policy: { billable: boolean }
  ) =>
    policy.billable
      ? { input: usage.input, output: usage.output, total: usage.input + usage.output }
      : { input: 0, output: 0, total: 0 },
}))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import { resetMidRunUsageCaches } from '@/lib/billing/core/mid-run-usage'
import { NEAR_LIMIT_USAGE_GATE_TTL_MS } from '@/lib/billing/core/usage-gate-cache'
import { isNonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import type { ExecutionContext } from '@/executor/types'
import { readTrustedExecutionCost } from '@/executor/utils/errors'
import { executeProviderRequest } from '@/providers'
import { prepareConversationGeneration } from '@/providers/conversation-generation'
import {
  bindConversationRequestContext,
  captureProviderConversationStep,
} from '@/providers/conversation-history'
import { ProviderError, type ProviderRequest } from '@/providers/types'

const { mockCheckExecutionUsageLimits } = billingUsageGateCacheMockFns

const attribution: BillingAttributionSnapshot = {
  actorUserId: 'actor',
  workspaceId: 'workspace',
  organizationId: null,
  billedAccountUserId: 'actor',
  billingEntity: { type: 'user', id: 'actor' },
  billingPeriod: { start: '2026-10-01T00:00:00.000Z', end: '2099-01-01T00:00:00.000Z' },
  payerSubscription: null,
}

function startRun(): ExecutionContext {
  return {
    workflowId: 'workflow',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: { duration: 0, billingAttribution: attribution },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    unrecordedModelCost: { total: 0 },
  }
}

/** One provider request inside the run, bound the way `executeProviderRequest` binds it. */
function startRequest(executionContext: ExecutionContext, isBYOK = false): ProviderRequest {
  const request: ProviderRequest = { model: 'model-a', isBYOK }
  bindConversationRequestContext(request, {
    executionContext,
    modelCost: { input: 0, output: 0, total: 0 },
  })
  return request
}

async function modelStep(request: ProviderRequest, input: number, output: number) {
  await prepareConversationGeneration(request, 'anthropic', { messages: [] })
  await captureProviderConversationStep(request, 'anthropic', { content: [] }, { input, output })
}

beforeEach(() => {
  setEnvFlags({ isHosted: true, isBillingEnabled: true })
  mockCheckExecutionUsageLimits.mockReset()
  mockCheckExecutionUsageLimits.mockResolvedValue({
    isExceeded: false,
    payerUsage: { currentUsage: 3, limit: 5 },
  })
  resetMidRunUsageCaches()
})
afterEach(resetEnvFlagsMock)

describe('run usage limit', () => {
  it('stops before the model call that would spend past the payer limit, billing the steps it ran', async () => {
    const run = startRun()
    const request = startRequest(run)
    await modelStep(request, 0.5, 0.5)

    await expect(modelStep(request, 0.5, 0.5)).resolves.toBeUndefined()

    const stop = prepareConversationGeneration(request, 'anthropic', { messages: [] })
    await expect(stop).rejects.toThrow('usage limit')
    const error = await stop.catch((caught: unknown) => caught)
    expect(isNonRetryableExecutionError(error)).toBe(true)
    expect(readTrustedExecutionCost(error)).toEqual({ input: 1, output: 1, total: 2 })
  })

  it('keeps the stop, unretried and billed, through a provider that rewraps its failures', async () => {
    mockExecuteRequest.mockImplementation(async (request: ProviderRequest) => {
      try {
        await modelStep(request, 1, 1)
        await modelStep(request, 1, 1)
        return { content: '', model: request.model }
      } catch (error) {
        throw new ProviderError(getErrorMessage(error), {
          startTime: '',
          endTime: '',
          duration: 0,
        })
      }
    })

    const failure = await executeProviderRequest(
      'anthropic',
      { model: 'model-a' },
      { executionContext: startRun() }
    ).catch((caught: unknown) => caught)

    expect(isNonRetryableExecutionError(failure)).toBe(true)
    expect(readTrustedExecutionCost(failure)).toEqual({ input: 1, output: 1, total: 2 })
  })

  it('counts every block of the run, not only the request that is running', async () => {
    const run = startRun()
    await modelStep(startRequest(run), 1, 1)
    const later = startRequest(run)

    const stop = prepareConversationGeneration(later, 'anthropic', { messages: [] })
    await expect(stop).rejects.toThrow('usage limit')
    expect(readTrustedExecutionCost(await stop.catch((caught: unknown) => caught))).toBeUndefined()
  })

  it('never stops a run that has spent nothing, even with the payer over its limit', async () => {
    mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })
    const request = startRequest(startRun())

    await expect(
      prepareConversationGeneration(request, 'anthropic', { messages: [] })
    ).resolves.toEqual({ messages: [] })
    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })

  it('never counts steps billed to the workspace key', async () => {
    const request = startRequest(startRun(), true)
    await modelStep(request, 50, 50)

    await prepareConversationGeneration(request, 'anthropic', { messages: [] })

    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })

  it('stops a member whose own cap the run reaches before the pool', async () => {
    mockCheckExecutionUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 10, limit: 1000 },
      memberUsage: { currentUsage: 9, limit: 10 },
    })
    const request = startRequest(startRun())
    await modelStep(request, 0.5, 0.5)

    await expect(
      prepareConversationGeneration(request, 'anthropic', { messages: [] })
    ).rejects.toThrow('usage limit')
  })

  it('keeps going when the payer has no member cap and ample headroom', async () => {
    mockCheckExecutionUsageLimits.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 10, limit: 1000 },
      memberUsage: { currentUsage: 9, limit: null },
    })
    const request = startRequest(startRun())
    await modelStep(request, 5, 5)

    await expect(
      prepareConversationGeneration(request, 'anthropic', { messages: [] })
    ).resolves.toEqual({ messages: [] })
  })

  it('stops when another run already took the payer past its limit', async () => {
    const request = startRequest(startRun())
    await modelStep(request, 0.1, 0.1)
    mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: true, scope: 'payer' })

    await expect(
      prepareConversationGeneration(request, 'anthropic', { messages: [] })
    ).rejects.toThrow('usage limit')
  })

  it.each([
    [
      'usage cannot be read',
      () => mockCheckExecutionUsageLimits.mockRejectedValueOnce(new Error('ledger read timed out')),
    ],
    [
      'the ledger is unavailable',
      () =>
        mockCheckExecutionUsageLimits.mockResolvedValueOnce({
          isExceeded: true,
          reason: 'usage_unavailable',
        }),
    ],
    [
      'the account is blocked',
      () =>
        mockCheckExecutionUsageLimits.mockResolvedValueOnce({
          isExceeded: true,
          reason: 'billing_blocked',
          scope: 'payer',
        }),
    ],
  ])('keeps the run going when %s, without reading again for a while', async (_case, answer) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const request = startRequest(startRun())
      await modelStep(request, 1, 1)
      mockCheckExecutionUsageLimits.mockClear()
      answer()

      await expect(modelStep(request, 1, 1)).resolves.toBeUndefined()
      await expect(modelStep(request, 1, 1)).resolves.toBeUndefined()
      expect(mockCheckExecutionUsageLimits).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(NEAR_LIMIT_USAGE_GATE_TTL_MS)
      await expect(
        prepareConversationGeneration(request, 'anthropic', { messages: [] })
      ).rejects.toThrow('usage limit')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads no usage for a paid payer, whose overage is billed', async () => {
    const run = startRun()
    run.metadata.billingAttribution = {
      ...attribution,
      payerSubscription: {
        id: 'sub',
        referenceId: 'actor',
        plan: 'pro',
        status: 'active',
        seats: 1,
        periodStart: null,
        periodEnd: null,
      },
    }
    const request = startRequest(run)
    await modelStep(request, 50, 50)

    await prepareConversationGeneration(request, 'anthropic', { messages: [] })

    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })

  it('reads no usage once the run is cancelled', async () => {
    const controller = new AbortController()
    const run = { ...startRun(), abortSignal: controller.signal }
    const request = startRequest(run)
    await modelStep(request, 5, 5)
    controller.abort()

    await prepareConversationGeneration(request, 'anthropic', { messages: [] })

    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })

  it('reads no usage on a self-hosted deployment', async () => {
    setEnvFlags({ isHosted: false })
    const request = startRequest(startRun())
    await modelStep(request, 5, 5)

    await prepareConversationGeneration(request, 'anthropic', { messages: [] })

    expect(mockCheckExecutionUsageLimits).not.toHaveBeenCalled()
  })
})
