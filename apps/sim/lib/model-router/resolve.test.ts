/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchGo, mockValidateModelProvider, mockGetMothershipBaseURL } = vi.hoisted(() => ({
  mockFetchGo: vi.fn(),
  mockValidateModelProvider: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: true,
  getCostMultiplier: () => 2,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { COPILOT_API_KEY: 'test-copilot-key' },
}))

vi.mock('@/lib/copilot/request/go/fetch', () => ({
  fetchGo: mockFetchGo,
}))

vi.mock('@/lib/copilot/server/agent-url', () => ({
  getMothershipBaseURL: mockGetMothershipBaseURL,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateModelProvider: mockValidateModelProvider,
}))

import { type AutoRoutingSignals, resolveAutoModel } from '@/lib/model-router/resolve'
import type { ExecutionContext } from '@/executor/types'

const ctx = {
  userId: 'user-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
} as unknown as ExecutionContext

/** Distinct-by-default signals so the module-level decision cache never collides across tests. */
function makeSignals(overrides: Partial<AutoRoutingSignals> = {}): AutoRoutingSignals {
  return {
    systemPrompt: `analyze the quarterly report ${Math.random()}`,
    lastMessage: 'here is the data to reconcile against the ledger',
    messageCount: 1,
    toolNames: ['exa_search'],
    hasAttachments: false,
    hasResponseFormat: false,
    approxInputTokens: 5000,
    ...overrides,
  }
}

function routerResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

describe('resolveAutoModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMothershipBaseURL.mockResolvedValue('https://copilot.test')
    mockValidateModelProvider.mockResolvedValue(undefined)
  })

  it('restricts routing to vision-capable tiers when attachments are present', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '2' }))
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals({ hasAttachments: true }),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('gpt-5.5')
    expect(result.tier).toBe('2')

    const body = JSON.parse(mockFetchGo.mock.calls[0][1].body as string)
    expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(['1', '2'])
  })

  it('routes trivially simple tasks to tier 1 without calling the router', async () => {
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals({ approxInputTokens: 100, toolNames: [], hasResponseFormat: false }),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('fireworks/glm-5.2')
    expect(result.tier).toBe('1')
    expect(result.decidedBy).toBe('heuristic')
    expect(result.billableRoutingCost).toBe(0)
    expect(mockFetchGo).not.toHaveBeenCalled()
  })

  it('uses the router choice and applies the cost multiplier when billable', async () => {
    mockFetchGo.mockResolvedValue(
      routerResponse({
        choice: '2',
        decidedBy: 'llm',
        usage: {
          model: 'glm-5.2',
          inputTokens: 900,
          cachedInputTokens: 0,
          outputTokens: 2,
          cost: 0.001,
        },
        billable: true,
      })
    )
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('fireworks/kimi-k3')
    expect(result.tier).toBe('2')
    expect(result.decidedBy).toBe('llm')
    expect(result.billableRoutingCost).toBeCloseTo(0.002)
  })

  it('does not bill when the response omits billable (fail-safe)', async () => {
    mockFetchGo.mockResolvedValue(
      routerResponse({
        choice: '1',
        usage: {
          model: 'glm-5.2',
          inputTokens: 900,
          cachedInputTokens: 0,
          outputTokens: 2,
          cost: 0.001,
        },
      })
    )
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('fireworks/glm-5.2')
    expect(result.billableRoutingCost).toBe(0)
  })

  it('falls back when the router call fails', async () => {
    mockFetchGo.mockRejectedValue(new Error('timeout'))
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.decidedBy).toBe('fallback')
  })

  it('falls back when the router returns an unknown choice', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: 'banana' }))
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.decidedBy).toBe('fallback')
  })

  it('falls back when every pool model is denied by workspace permissions', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '1' }))
    mockValidateModelProvider.mockRejectedValue(new Error('provider blocked'))
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.decidedBy).toBe('fallback')
  })

  it('serves repeated identical signals from the decision cache without re-calling the router', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '1' }))
    const signals = makeSignals()

    const first = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals,
      fallbackModel: 'claude-sonnet-5',
    })
    const second = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals,
      fallbackModel: 'claude-sonnet-5',
    })

    expect(first.decidedBy).toBe('llm')
    expect(second.decidedBy).toBe('cache')
    expect(second.model).toBe('fireworks/glm-5.2')
    expect(second.tier).toBe('1')
    expect(second.billableRoutingCost).toBe(0)
    expect(mockFetchGo).toHaveBeenCalledTimes(1)
  })
})
