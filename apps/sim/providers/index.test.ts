/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/core/config/feature-flags', () => ({
  getCostMultiplier: vi.fn(() => 1),
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
            // Tool segments do not currently carry `cost` (tool cost lives on
            // the parent's response.cost.toolCost), but if a future provider
            // ever wrote a tool-segment cost we must NOT zero it.
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
    // Helper only zeroes type==='model'; the tool segment is untouched.
    expect((tool as { cost?: unknown }).cost).toBeUndefined()
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
