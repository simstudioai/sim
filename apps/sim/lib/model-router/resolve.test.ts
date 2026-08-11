/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchGo,
  mockValidateModelProvider,
  mockGetMothershipBaseURL,
  mockGetProviderFromModel,
} = vi.hoisted(() => ({
  mockFetchGo: vi.fn(),
  mockValidateModelProvider: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
  mockGetProviderFromModel: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: true,
  getCostMultiplier: () => 2,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { COPILOT_API_KEY: 'test-copilot-key' },
  envBoolean: () => undefined,
  getEnv: () => undefined,
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

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  getProviderFromModel: mockGetProviderFromModel,
}))

import {
  type AutoRoutingSignals,
  addAutoRoutingCost,
  resolveAutoModel,
} from '@/lib/model-router/resolve'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const ctx = {
  userId: 'user-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
} as unknown as ExecutionContext

/** Distinct-by-default signals so the module-level decision cache never collides across tests. */
let signalSeq = 0
function makeSignals(overrides: Partial<AutoRoutingSignals> = {}): AutoRoutingSignals {
  return {
    systemPrompt: `analyze the quarterly report ${++signalSeq}`,
    lastMessage: 'here is the data to reconcile against the ledger',
    messageCount: 1,
    toolNames: ['exa_search'],
    mediaKind: 'none',
    hasResponseFormat: false,
    approxInputTokens: 5000,
    ...overrides,
  }
}

function routerResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

describe('addAutoRoutingCost', () => {
  it('adds a billable routing call to a settled provider cost', () => {
    expect(addAutoRoutingCost({ input: 0.001, output: 0.002, total: 0.003 }, 0.0005)).toEqual({
      input: 0.001,
      output: 0.002,
      routing: 0.0005,
      total: 0.0035,
    })
  })

  it('leaves provider cost unchanged when routing was not billable', () => {
    const cost = { input: 0.001, output: 0.002, total: 0.003 }

    expect(addAutoRoutingCost(cost, 0)).toBe(cost)
  })
})

describe('resolveAutoModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMothershipBaseURL.mockResolvedValue('https://copilot.test')
    mockValidateModelProvider.mockResolvedValue(undefined)
    mockGetProviderFromModel.mockReturnValue('fireworks')
  })

  /** The full pool, exactly as specified: media kind → tier → model. */
  const POOL_CASES: Array<{
    mediaKind: AutoRoutingSignals['mediaKind']
    byTier: string[]
  }> = [
    {
      mediaKind: 'none',
      byTier: ['fireworks/glm-5.2', 'fireworks/glm-5.2', 'fireworks/kimi-k3'],
    },
    {
      mediaKind: 'image',
      byTier: ['gemini-3.6-flash', 'fireworks/kimi-k3', 'fireworks/kimi-k3'],
    },
    {
      mediaKind: 'file',
      byTier: ['gemini-3.6-flash', 'claude-sonnet-5', 'gpt-5.6-sol'],
    },
  ]

  for (const { mediaKind, byTier } of POOL_CASES) {
    byTier.forEach((expected, index) => {
      const tier = String(index + 1)
      it(`routes ${mediaKind} tier ${tier} to ${expected}`, async () => {
        mockFetchGo.mockResolvedValue(routerResponse({ choice: tier }))

        const result = await resolveAutoModel({
          ctx,
          blockId: 'b1',
          signals: makeSignals({ mediaKind }),
          fallbackModel: 'claude-sonnet-5',
        })

        expect(result.model).toBe(expected)
        expect(result.tier).toBe(tier)
      })
    })
  }

  it('offers all three tiers and no model name to the router', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '2' }))

    await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals({ mediaKind: 'image' }),
      fallbackModel: 'claude-sonnet-5',
    })

    const body = JSON.parse(mockFetchGo.mock.calls[0][1].body as string)
    expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(['1', '2', '3'])
    // Media kind is Sim's business: the wire carries only its presence.
    expect(body.signals.hasMedia).toBe(true)
    expect(body.signals.mediaKind).toBeUndefined()
    for (const model of ['glm', 'kimi', 'gemini', 'gpt-5.6-sol', 'sonnet']) {
      expect(JSON.stringify(body)).not.toContain(model)
    }
  })

  it('forwards caller-projected signals without rescanning model content or controls', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'LOW_ENTROPY_SECRET',
        plaintext: 'x',
        encryptedValue: 'encrypted-low-entropy-secret',
      },
    ])
    registry.recordResolved('LOW_ENTROPY_SECRET', 'x')
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '1' }))

    await resolveAutoModel({
      ctx: { ...ctx, resolvedSecretTraceRegistry: registry },
      blockId: 'b1',
      signals: makeSignals({
        systemPrompt: 'Box eSign {{LOW_ENTROPY_SECRET}}',
        lastMessage: 'Brex {{LOW_ENTROPY_SECRET}}',
        messageCount: 123,
        toolNames: ['x', 'true'],
        hasResponseFormat: true,
        approxInputTokens: 123,
      }),
      fallbackModel: 'claude-sonnet-5',
    })

    const body = JSON.parse(mockFetchGo.mock.calls[0][1].body as string)
    expect(body.signals).toEqual({
      systemPrompt: 'Box eSign {{LOW_ENTROPY_SECRET}}',
      lastMessage: 'Brex {{LOW_ENTROPY_SECRET}}',
      messageCount: 123,
      toolNames: ['x', 'true'],
      hasMedia: false,
      hasResponseFormat: true,
      approxInputTokens: 123,
    })
  })

  it('does not infer provenance from dormant catalog values in routing signals', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'DORMANT_SECRET',
        plaintext: 'ordinary-tool-name',
        encryptedValue: 'encrypted-dormant-secret',
      },
    ])
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '1' }))

    await resolveAutoModel({
      ctx: { ...ctx, resolvedSecretTraceRegistry: registry },
      blockId: 'b1',
      signals: makeSignals({ toolNames: ['ordinary-tool-name'] }),
      fallbackModel: 'claude-sonnet-5',
    })

    const body = JSON.parse(mockFetchGo.mock.calls[0][1].body as string)
    expect(body.signals.toolNames).toEqual(['ordinary-tool-name'])
  })

  it('does not gate caller-projected signals on ambient registry completeness', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '1' }))

    const result = await resolveAutoModel({
      ctx: { ...ctx, resolvedSecretTraceRegistry: registry },
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })

    expect(result.model).toBe('fireworks/glm-5.2')
    expect(result.tier).toBe('1')
    expect(mockGetMothershipBaseURL).toHaveBeenCalled()
    expect(mockFetchGo).toHaveBeenCalled()
  })

  it('never crosses media kinds when walking down from a denied tier', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '3' }))
    // gpt-5.6-sol denied; the file column must drop to sonnet, never to a
    // Fireworks model that cannot accept the attachment at all.
    mockValidateModelProvider.mockImplementation(async (_u, _w, model: string) => {
      if (model === 'gpt-5.6-sol') throw new Error('provider blocked')
    })

    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals({ mediaKind: 'file' }),
      fallbackModel: 'claude-sonnet-5',
    })

    expect(result.model).toBe('claude-sonnet-5')
    expect(result.tier).toBe('3')
  })

  it('classifies even a tiny toolless prompt instead of assuming the lowest tier', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '3' }))

    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals({
        approxInputTokens: 20,
        toolNames: [],
        hasResponseFormat: false,
      }),
      fallbackModel: 'claude-sonnet-5',
    })

    expect(mockFetchGo).toHaveBeenCalledTimes(1)
    expect(result.model).toBe('fireworks/kimi-k3')
    expect(result.decidedBy).toBe('llm')
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
    expect(result.model).toBe('fireworks/glm-5.2')
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

  it('falls back when every pool model resolves to a blacklisted provider', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '2' }))
    mockGetProviderFromModel.mockImplementation(() => {
      throw new Error('Provider "fireworks" is not available')
    })

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
