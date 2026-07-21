/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAttributedUsageLimits,
  mockExecuteProviderRequest,
  mockGetAllModelProviders,
  mockGetProviderFromModel,
  mockRecordUsage,
  mockReleaseExecutionSlot,
  mockReserveExecutionSlot,
  mockStableEventKey,
  mockToBillingContext,
  mockValidateModelProvider,
} = vi.hoisted(() => ({
  mockCheckAttributedUsageLimits: vi.fn(),
  mockExecuteProviderRequest: vi.fn(),
  mockGetAllModelProviders: vi.fn(),
  mockGetProviderFromModel: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockReserveExecutionSlot: vi.fn(),
  mockStableEventKey: vi.fn(),
  mockToBillingContext: vi.fn(),
  mockValidateModelProvider: vi.fn(),
}))

vi.mock('@/providers', () => ({ executeProviderRequest: mockExecuteProviderRequest }))
vi.mock('@/providers/utils', () => ({
  getAllModelProviders: mockGetAllModelProviders,
  getProviderFromModel: mockGetProviderFromModel,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateModelProvider: mockValidateModelProvider,
}))
vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  reserveExecutionSlot: mockReserveExecutionSlot,
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  toBillingContext: mockToBillingContext,
}))
vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
  stableEventKey: mockStableEventKey,
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: false, isBillingEnabled: false }))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  evaluateWorkflowEvalAgentCriteria,
  type WorkflowEvalAgentCriterionWorkItem,
} from '@/lib/workflows/evals/agent-evaluator.server'
import type { WorkflowEvalJudgeTrace } from '@/lib/workflows/evals/judge-trace.server'

const ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'user-1',
  billingEntity: { type: 'user', id: 'user-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const TRACE: WorkflowEvalJudgeTrace = {
  spanCount: 1,
  blocks: [
    {
      blockId: 'block-1',
      name: 'Block 1',
      type: 'function',
      occurrence: 1,
      executionOrder: 1,
      status: 'success',
      errorHandled: false,
      startTime: '2026-07-17T00:00:00.000Z',
      endTime: '2026-07-17T00:00:00.010Z',
      durationMs: 10,
      coordinates: [],
    },
  ],
  selectedOutputs: [
    {
      blockId: 'block-1',
      path: 'content',
      occurrences: [
        { occurrence: 1, executionOrder: 1, coordinates: [], value: 'subject evidence' },
      ],
    },
  ],
  agentToolCalls: [],
}

function criterion(ordinal: number): WorkflowEvalAgentCriterionWorkItem {
  return {
    criterionRunId: `criterion-run-${ordinal}`,
    criterion: {
      id: `criterion-${ordinal}`,
      name: `Criterion ${ordinal}`,
      description: `Judge criterion ${ordinal}`,
    },
  }
}

function providerResponse(content = '{"verdict":"pass","confidence":0.9,"reason":"Good"}') {
  return {
    content,
    model: 'gpt-test-response',
    tokens: { input: 100, output: 20, total: 120 },
    cost: {
      input: 0.001,
      output: 0.002,
      total: 0.003,
      pricing: { input: 1, output: 1, updatedAt: '2026-07-17' },
    },
  }
}

function input(overrides: Partial<Parameters<typeof evaluateWorkflowEvalAgentCriteria>[0]> = {}) {
  return {
    runId: 'run-1',
    testId: 'test-1',
    testRunId: 'test-run-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    model: 'gpt-test',
    billingAttribution: ATTRIBUTION,
    trace: TRACE,
    criteria: [criterion(0)],
    onCriterionStarted: vi.fn().mockResolvedValue(undefined),
    onCriterionFinished: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('evaluateWorkflowEvalAgentCriteria', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllModelProviders.mockReturnValue({ 'gpt-test': 'openai' })
    mockGetProviderFromModel.mockReturnValue('openai')
    mockValidateModelProvider.mockResolvedValue(undefined)
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mockReserveExecutionSlot.mockResolvedValue({ reserved: true, created: true })
    mockReleaseExecutionSlot.mockResolvedValue(undefined)
    mockExecuteProviderRequest.mockResolvedValue(providerResponse())
    mockRecordUsage.mockResolvedValue(undefined)
    mockStableEventKey.mockReturnValue('stable-event-key')
    mockToBillingContext.mockReturnValue({
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
  })

  it('runs a strict isolated provider call and records its usage before completing', async () => {
    const onCriterionStarted = vi.fn().mockResolvedValue(undefined)
    const onCriterionFinished = vi.fn().mockResolvedValue(undefined)
    const result = await evaluateWorkflowEvalAgentCriteria(
      input({ onCriterionStarted, onCriterionFinished })
    )

    expect(result).toEqual([
      expect.objectContaining({
        phase: 'completed',
        verdict: 'pass',
        confidence: 0.9,
        reason: 'Good',
        providerId: 'openai',
        responseModel: 'gpt-test-response',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cost: 0.003,
      }),
    ])
    expect(mockReserveExecutionSlot).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 'criterion-run-0' })
    )
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('criterion-run-0')
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            source: 'eval',
            category: 'model',
            cost: 0.003,
            eventKey: 'stable-event-key',
          }),
        ],
      })
    )
    expect(mockStableEventKey).toHaveBeenCalledWith({
      source: 'eval',
      runId: 'run-1',
      testRunId: 'test-run-1',
      criterionRunId: 'criterion-run-0',
      model: 'gpt-test',
      promptVersion: 'workflow_eval_criterion_v4',
    })
    const request = mockExecuteProviderRequest.mock.calls[0]?.[1]
    expect(request).toEqual(
      expect.objectContaining({
        model: 'gpt-test',
        temperature: 0,
        maxTokens: 512,
        stream: false,
        maxRetries: 0,
      })
    )
    expect(request.systemPrompt).toContain('Keep the reason concise and evidence-based')
    expect(request.systemPrompt).toContain('warning only when confidence is below 0.5')
    expect(request.systemPrompt).toContain('Expected Technical route; got Billing.')
    expect(request.responseFormat.schema.properties.reason.maxLength).toBe(20_000)
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('environmentVariables')
    expect(request).not.toHaveProperty('workflowVariables')
    expect(request).not.toHaveProperty('blockData')
    expect(request).not.toHaveProperty('context')
    expect(request.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('subject evidence'),
      }),
    ])
    expect(onCriterionStarted).toHaveBeenCalledTimes(1)
    expect(onCriterionFinished).toHaveBeenCalledWith(
      expect.objectContaining({ criterionRunId: 'criterion-run-0' }),
      0,
      expect.objectContaining({ phase: 'completed' })
    )
  })

  it('rejects unknown models without reserving usage or calling a provider', async () => {
    mockGetAllModelProviders.mockReturnValue({})
    const onCriterionFinished = vi.fn().mockResolvedValue(undefined)

    const result = await evaluateWorkflowEvalAgentCriteria(input({ onCriterionFinished }))

    expect(result[0]).toMatchObject({
      phase: 'error',
      error: { code: 'agent_judge_model_unavailable' },
    })
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    expect(mockReserveExecutionSlot).not.toHaveBeenCalled()
    expect(onCriterionFinished).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.objectContaining({ phase: 'error' })
    )
  })

  it('bills a malformed paid response and preserves its usage metadata in the error', async () => {
    mockExecuteProviderRequest.mockResolvedValue(
      providerResponse('```json\n{"verdict":"pass","confidence":1,"reason":"Good"}\n```')
    )

    const [result] = await evaluateWorkflowEvalAgentCriteria(input())

    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      phase: 'error',
      responseModel: 'gpt-test-response',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cost: 0.003,
      error: { code: 'agent_judge_failed' },
    })
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('criterion-run-0')
  })

  it.each([
    '{"verdict":"pass","confidence":1,"reason":"Good","extra":true}',
    '{"verdict":"pass","confidence":1.1,"reason":"Good"}',
    '{"verdict":"pass","confidence":1}',
  ])('rejects nonconforming structured output without repair: %s', async (content) => {
    mockExecuteProviderRequest.mockResolvedValue(providerResponse(content))

    const [result] = await evaluateWorkflowEvalAgentCriteria(input())

    expect(result).toMatchObject({
      phase: 'error',
      error: { code: 'agent_judge_failed' },
    })
    expect(mockRecordUsage).toHaveBeenCalledOnce()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('criterion-run-0')
  })

  it('rejects warning verdicts at or above 50% confidence', async () => {
    mockExecuteProviderRequest.mockResolvedValue(
      providerResponse('{"verdict":"warning","confidence":0.5,"reason":"Unclear evidence"}')
    )

    const [result] = await evaluateWorkflowEvalAgentCriteria(input())

    expect(result).toMatchObject({
      phase: 'error',
      error: {
        code: 'agent_judge_failed',
        message: expect.stringContaining('warning confidence must be below 0.5'),
      },
    })
  })

  it('reports usage denial as a criterion error without reserving or calling a provider', async () => {
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Usage limit exceeded',
    })

    const [result] = await evaluateWorkflowEvalAgentCriteria(input())

    expect(result).toMatchObject({
      phase: 'error',
      error: {
        code: 'agent_judge_failed',
        message: expect.stringContaining('Usage limit exceeded'),
      },
    })
    expect(mockReserveExecutionSlot).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('persists BYOK zero cost without inventing hosted usage', async () => {
    const response = providerResponse()
    response.cost.total = 0
    mockExecuteProviderRequest.mockResolvedValue(response)

    const [result] = await evaluateWorkflowEvalAgentCriteria(input())

    expect(result).toMatchObject({ phase: 'completed', cost: 0 })
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [expect.objectContaining({ cost: 0 })] })
    )
  })

  it('keeps independent criterion calls bounded at four and preserves definition order', async () => {
    let active = 0
    let peak = 0
    mockExecuteProviderRequest.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return providerResponse()
    })
    const criteria = Array.from({ length: 7 }, (_, ordinal) => criterion(ordinal))

    const result = await evaluateWorkflowEvalAgentCriteria(input({ criteria }))

    expect(peak).toBe(4)
    expect(result).toHaveLength(7)
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(7)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledTimes(7)
  })

  it('releases the criterion reservation when the provider fails', async () => {
    mockExecuteProviderRequest.mockRejectedValue(new Error('provider unavailable'))

    const [result] = await evaluateWorkflowEvalAgentCriteria(input())

    expect(result).toMatchObject({
      phase: 'error',
      error: { code: 'agent_judge_failed' },
    })
    expect(mockRecordUsage).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('criterion-run-0')
  })

  it('fails the coordinator boundary when paid usage cannot be recorded', async () => {
    mockRecordUsage.mockRejectedValue(new Error('ledger unavailable'))
    const onCriterionFinished = vi.fn().mockResolvedValue(undefined)
    const criteria = Array.from({ length: 7 }, (_, ordinal) => criterion(ordinal))

    await expect(
      evaluateWorkflowEvalAgentCriteria(input({ criteria, onCriterionFinished }))
    ).rejects.toThrow('fatal criterion boundary error')
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(4)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledTimes(4)
    expect(onCriterionFinished).not.toHaveBeenCalled()
  })

  it('fails the coordinator boundary when a reservation cannot be released', async () => {
    mockReleaseExecutionSlot.mockRejectedValue(new Error('reservation store unavailable'))
    const onCriterionFinished = vi.fn().mockResolvedValue(undefined)

    await expect(evaluateWorkflowEvalAgentCriteria(input({ onCriterionFinished }))).rejects.toThrow(
      'fatal criterion boundary error'
    )
    expect(mockRecordUsage).toHaveBeenCalledOnce()
    expect(onCriterionFinished).not.toHaveBeenCalled()
  })

  it('fails before model resolution when criterion identities or attribution are invalid', async () => {
    await expect(
      evaluateWorkflowEvalAgentCriteria(input({ criteria: [criterion(0), criterion(0)] }))
    ).rejects.toThrow('criterion call identities must be unique')
    await expect(
      evaluateWorkflowEvalAgentCriteria(
        input({
          billingAttribution: { ...ATTRIBUTION, actorUserId: 'different-user' },
        })
      )
    ).rejects.toThrow('billing attribution does not match')
    expect(mockGetAllModelProviders).not.toHaveBeenCalled()
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })
})
