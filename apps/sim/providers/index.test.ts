/**
 * @vitest-environment node
 */
import { envFlagsMockFns, resetEnvFlagsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetApiKeyWithBYOK, mockExecuteRequest } = vi.hoisted(() => ({
  mockGetApiKeyWithBYOK: vi.fn(),
  mockExecuteRequest: vi.fn(),
}))

vi.mock('@/lib/api-key/byok', () => ({
  getApiKeyWithBYOK: (...args: unknown[]) => mockGetApiKeyWithBYOK(...args),
}))

vi.mock('@/providers/registry', () => ({
  getProviderExecutor: vi.fn().mockResolvedValue({
    executeRequest: (...args: unknown[]) => mockExecuteRequest(...args),
  }),
}))

import { executeProviderRequest } from '@/providers'
import type { ProviderResponse } from '@/providers/types'

const HOSTED_RATE_INPUT_COST = 0.340285
const HOSTED_RATE_OUTPUT_COST = 0.0387
const HOSTED_RATE_TOTAL_COST = HOSTED_RATE_INPUT_COST + HOSTED_RATE_OUTPUT_COST

function makeAnthropicResponse(): ProviderResponse {
  // Mirrors the shape produced by Anthropic core for a real BYOK execution
  // (gross hosted-rate cost was written into time-segment cost by the trace
  // enricher even though the block-level cost should be zeroed for BYOK).
  return {
    content: 'hello',
    model: 'claude-opus-4-6',
    tokens: { input: 68057, output: 1548, total: 69605 },
    cost: {
      input: HOSTED_RATE_INPUT_COST,
      output: HOSTED_RATE_OUTPUT_COST,
      total: HOSTED_RATE_TOTAL_COST,
      pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
    },
    timing: {
      startTime: '2026-04-30T21:27:37.878Z',
      endTime: '2026-04-30T21:28:19.836Z',
      duration: 41958,
      timeSegments: [
        {
          type: 'model',
          name: 'claude-opus-4-6',
          startTime: 1777584457878,
          endTime: 1777584499836,
          duration: 41958,
          tokens: { input: 68057, output: 1548, total: 69605 },
          cost: {
            input: HOSTED_RATE_INPUT_COST,
            output: HOSTED_RATE_OUTPUT_COST,
            total: HOSTED_RATE_TOTAL_COST,
          },
        },
      ],
    },
  }
}

describe('executeProviderRequest — BYOK regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('zeroes block-level model cost for BYOK callers (existing behavior)', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    mockExecuteRequest.mockResolvedValue(makeAnthropicResponse())

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.total).toBe(0)
    expect(result.cost?.input).toBe(0)
    expect(result.cost?.output).toBe(0)
  })

  it('zeroes per-segment model cost for BYOK callers so trace aggregation does not re-charge', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    mockExecuteRequest.mockResolvedValue(makeAnthropicResponse())

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    const segment = result.timing?.timeSegments?.[0]
    expect(segment?.cost).toBeDefined()
    expect(segment?.cost?.input).toBe(0)
    expect(segment?.cost?.output).toBe(0)
    expect(segment?.cost?.total).toBe(0)
    // Tokens must be preserved so the UI still displays usage even when
    // BYOK callers are not billed.
    expect(segment?.tokens?.input).toBe(68057)
    expect(segment?.tokens?.output).toBe(1548)
  })

  it('does not zero per-segment cost for non-BYOK hosted callers', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    mockExecuteRequest.mockResolvedValue(makeAnthropicResponse())

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    const segment = result.timing?.timeSegments?.[0]
    expect(segment?.cost?.total).toBeCloseTo(HOSTED_RATE_TOTAL_COST, 6)
  })

  /**
   * Provider cost is now preferred over recomputation, because only the
   * provider knows its cache tiers. Tool cost is the hazard in that branch:
   * `executeProviderRequest` re-derives it from `toolResults`, so a provider
   * that folded it into its own total must not have it counted twice.
   */
  it('counts a provider-folded tool cost exactly once', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150 },
      cost: {
        input: 0.0005,
        output: 0.00125,
        total: 0.00675,
        toolCost: 0.005,
        pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
      },
      toolResults: [{ cost: { total: 0.005 } }],
    } as ProviderResponse)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.toolCost).toBeCloseTo(0.005, 8)
    expect(result.cost?.total).toBeCloseTo(0.00675, 8)
  })

  /**
   * Gemini hands the same cost object to its response and its model segment.
   * Adding tool cost by mutation would charge it to the segment too.
   */
  it('does not leak tool cost into a segment sharing the provider cost object', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    envFlagsMockFns.getCostMultiplier.mockReturnValue(1)
    const sharedCost = {
      input: 0.0005,
      output: 0.00125,
      total: 0.00175,
      pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
    }
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150 },
      cost: sharedCost,
      toolResults: [{ cost: { total: 0.004 } }],
      timing: {
        startTime: '2026-04-30T21:27:37.878Z',
        endTime: '2026-04-30T21:27:38.000Z',
        duration: 122,
        timeSegments: [
          {
            type: 'model',
            name: 'claude-opus-4-6',
            startTime: 1777584457878,
            endTime: 1777584457940,
            duration: 62,
            cost: sharedCost,
          },
        ],
      },
    } as ProviderResponse)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.total).toBeCloseTo(0.00575, 8)
    expect(result.timing?.timeSegments?.[0]?.cost?.total).toBeCloseTo(0.00175, 8)
  })

  it('keeps the provider cost rather than recomputing it from tokens', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    // Cache-tier pricing this layer cannot rebuild from `tokens` alone.
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150, cacheRead: 900, cacheWrite: 400 },
      cost: {
        input: 0.0123,
        output: 0.00125,
        total: 0.01355,
        pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
      },
    } as ProviderResponse)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    expect(result.cost?.input).toBeCloseTo(0.0123, 8)
    expect(result.cost?.total).toBeCloseTo(0.01355, 8)
  })

  it('preserves tool segment cost (BYOK does not suppress tool charges)', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    const responseWithToolSegment: ProviderResponse = {
      content: 'hi',
      model: 'claude-opus-4-6',
      tokens: { input: 100, output: 50, total: 150 },
      cost: {
        input: 0.0005,
        output: 0.00125,
        total: 0.00175,
        pricing: { input: 5.0, output: 25.0, updatedAt: '2026-04-01' },
      },
      timing: {
        startTime: '2026-04-30T21:27:37.878Z',
        endTime: '2026-04-30T21:27:38.000Z',
        duration: 122,
        timeSegments: [
          {
            type: 'model',
            name: 'claude-opus-4-6',
            startTime: 1777584457878,
            endTime: 1777584457940,
            duration: 62,
            cost: { input: 0.0005, output: 0.00125, total: 0.00175 },
          },
          {
            type: 'tool',
            name: 'firecrawl_scrape',
            startTime: 1777584457940,
            endTime: 1777584458000,
            duration: 60,
            cost: { total: 0.01 },
          },
        ],
      },
    }
    mockExecuteRequest.mockResolvedValue(responseWithToolSegment)

    const result = (await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
    })) as ProviderResponse

    const [model, tool] = result.timing!.timeSegments!
    expect(model.cost?.total).toBe(0)
    expect(tool.type).toBe('tool')
    expect(tool.cost?.total).toBe(0.01)
  })

  it('zeroes per-segment cost on streaming responses for BYOK callers', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    const segments = [
      {
        type: 'model' as const,
        name: 'claude-opus-4-6',
        startTime: 1777584457878,
        endTime: 1777584499836,
        duration: 41958,
        cost: {
          input: HOSTED_RATE_INPUT_COST,
          output: HOSTED_RATE_OUTPUT_COST,
          total: HOSTED_RATE_TOTAL_COST,
        },
      },
    ]
    const streamingResponse = {
      stream: new ReadableStream(),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'claude-opus-4-6',
          tokens: { input: 0, output: 0, total: 0 },
          providerTiming: {
            startTime: '2026-04-30T21:27:37.878Z',
            endTime: '2026-04-30T21:28:19.836Z',
            duration: 41958,
            timeSegments: segments,
          },
          cost: {
            input: HOSTED_RATE_INPUT_COST,
            output: HOSTED_RATE_OUTPUT_COST,
            total: HOSTED_RATE_TOTAL_COST,
          },
        },
        logs: [],
      },
    }
    mockExecuteRequest.mockResolvedValue(streamingResponse)

    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      stream: true,
    })

    expect(segments[0].cost.total).toBe(0)
    expect(segments[0].cost.input).toBe(0)
    expect(segments[0].cost.output).toBe(0)
  })
})

/**
 * Streaming and non-streaming must charge identically. Providers price tokens
 * inside the stream drain without knowing key provenance or the margin, so the
 * shared policy is installed on the live output before the stream is returned.
 */
describe('executeProviderRequest — streaming cost policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
  })

  afterEach(resetEnvFlagsMock)

  function makeStreamingExecution(initialCost?: Record<string, number>) {
    return {
      stream: new ReadableStream(),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'claude-opus-4-6',
          tokens: { input: 0, output: 0, total: 0 },
          ...(initialCost ? { cost: initialCost } : {}),
        },
        logs: [],
      },
    }
  }

  it('applies the cost multiplier to cost the provider writes while streaming', async () => {
    envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
    const streaming = makeStreamingExecution()
    mockExecuteRequest.mockResolvedValue(streaming)

    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      stream: true,
    })

    streaming.execution.output.cost = { input: 1, output: 2, total: 3 }

    expect(streaming.execution.output.cost).toMatchObject({ input: 2, output: 4, total: 6 })
  })

  it('does not charge for models Sim does not host', async () => {
    const streaming = {
      stream: new ReadableStream(),
      execution: {
        success: true,
        output: {
          content: '',
          model: 'llama-3.3-70b-versatile',
          tokens: { input: 0, output: 0, total: 0 },
        },
        logs: [],
      },
    }
    mockExecuteRequest.mockResolvedValue(streaming)

    await executeProviderRequest('groq', {
      model: 'llama-3.3-70b-versatile',
      workspaceId: 'ws-1',
      stream: true,
    })

    streaming.execution.output.cost = { input: 0.5, output: 1.5, total: 2 }

    expect(streaming.execution.output.cost).toMatchObject({ input: 0, output: 0, total: 0 })
  })

  it('keeps tool cost from a settled stream that priced its tools before returning', async () => {
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-byok', isBYOK: true })
    const streaming = makeStreamingExecution({
      input: 0.01,
      output: 0.02,
      total: 0.035,
      toolCost: 0.005,
    })
    mockExecuteRequest.mockResolvedValue(streaming)

    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      stream: true,
    })

    expect(streaming.execution.output.cost).toMatchObject({
      input: 0,
      output: 0,
      total: 0.005,
      toolCost: 0.005,
    })
  })
})

/**
 * `reasoningEffort`, `verbosity`, and `thinkingLevel` can be bound to a variable or block
 * reference in the agent block, so by the time they reach the provider they hold whatever
 * that reference resolved to rather than a value picked from a list.
 */
describe('executeProviderRequest — model level normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetApiKeyWithBYOK.mockResolvedValue({ apiKey: 'sk-rotating', isBYOK: false })
    mockExecuteRequest.mockResolvedValue({
      content: 'hi',
      model: 'gpt-5',
      tokens: { input: 1, output: 1, total: 2 },
    } as ProviderResponse)
  })

  const sentRequest = () => mockExecuteRequest.mock.calls[0][0] as Record<string, unknown>

  it('trims and lower-cases levels a reference resolved to', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: ' High ',
      verbosity: 'LOW',
    })

    expect(sentRequest().reasoningEffort).toBe('high')
    expect(sentRequest().verbosity).toBe('low')
  })

  it('trims and lower-cases a thinking level a reference resolved to', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5',
      workspaceId: 'ws-1',
      thinkingLevel: ' High ',
    })

    expect(sentRequest().thinkingLevel).toBe('high')
  })

  it('treats a level that resolved to nothing as unset rather than an empty string', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: '',
      verbosity: '   ',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
    expect(sentRequest().verbosity).toBeUndefined()
  })

  /**
   * Providers treat an explicit `'none'` as "thinking off" and an absent value as "send
   * nothing", so a reference that resolved to nothing must land on the latter.
   */
  it('treats a thinking level that resolved to nothing as unset, not as none', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5',
      workspaceId: 'ws-1',
      thinkingLevel: '  ',
    })

    expect(sentRequest().thinkingLevel).toBeUndefined()
  })

  it('preserves an explicit none thinking level', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-sonnet-5',
      workspaceId: 'ws-1',
      thinkingLevel: 'none',
    })

    expect(sentRequest().thinkingLevel).toBe('none')
  })

  it('leaves an already-valid level untouched', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: 'medium',
      verbosity: 'high',
    })

    expect(sentRequest().reasoningEffort).toBe('medium')
    expect(sentRequest().verbosity).toBe('high')
  })

  /**
   * Sim's per-model level lists drive the pickers and can lag a provider that has started
   * accepting a new level, so an unrecognized level is forwarded rather than dropped: the
   * provider answers with an error naming the values it accepts, instead of Sim silently
   * substituting the model default and quietly corrupting a sweep.
   */
  it('forwards a level the model does not declare so the provider reports it', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-5',
      workspaceId: 'ws-1',
      reasoningEffort: 'xhigh',
    })

    expect(sentRequest().reasoningEffort).toBe('xhigh')
  })

  it('still drops levels the resolved model does not support', async () => {
    await executeProviderRequest('anthropic', {
      model: 'claude-opus-4-6',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
      verbosity: 'high',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
    expect(sentRequest().verbosity).toBeUndefined()
  })

  /**
   * A model the catalogue has never seen is unknown, not known-incapable — which is exactly
   * how a newly released model arrives through a reference before Sim catalogues it. The
   * provider decides, rather than the level being discarded on a stale list.
   */
  it('forwards levels for a model absent from the catalogue', async () => {
    await executeProviderRequest('openai', {
      model: 'gpt-6-unreleased',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    })

    expect(sentRequest().reasoningEffort).toBe('high')
  })

  it('still drops levels for a dynamic-provider model that does not take them', async () => {
    await executeProviderRequest('ollama', {
      model: 'ollama/llama3',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    })

    expect(sentRequest().reasoningEffort).toBeUndefined()
  })
})
