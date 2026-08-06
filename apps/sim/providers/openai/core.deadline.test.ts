/**
 * @vitest-environment node
 *
 * A non-streaming generation is silent on the wire until it finishes, so nothing but an
 * explicit deadline can bound it. A streaming one emits continuously and must NOT carry
 * a total deadline, or a long answer still arriving normally gets cut off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import { PROVIDER_REQUEST_TIMEOUT_MS } from '@/providers/timeouts'
import type { ProviderRequest } from '@/providers/types'

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: () => false,
  calculateCost: () => ({ input: 0, output: 0, total: 0 }),
  sumToolCosts: () => 0,
  enforceStrictSchema: (schema: unknown) => schema,
  prepareToolExecution: () => ({ toolParams: {}, executionParams: {} }),
  prepareToolsWithUsageControl: (tools: unknown[]) => ({
    tools,
    toolChoice: undefined,
    forcedTools: [],
    hasFilteredTools: false,
  }),
  trackForcedToolUsage: () => ({ hasUsedForcedTool: false, usedForcedTools: [] }),
  supportsReasoningEffort: () => false,
}))

const COMPLETED = {
  id: 'resp_1',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
}

describe('provider request deadline', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

  beforeEach(() => vi.clearAllMocks())

  function run(fetchMock: unknown, request: Partial<ProviderRequest> = {}) {
    return executeResponsesProviderRequest(
      { apiKey: 'k', model: 'gpt-5.5', messages: [{ role: 'user', content: 'hi' }], ...request },
      {
        providerId: 'openai',
        providerLabel: 'OpenAI',
        modelName: 'gpt-5.5',
        endpoint: 'https://api.openai.com/v1/responses',
        headers: { Authorization: 'Bearer k' },
        logger,
        fetch: fetchMock as typeof fetch,
      }
    )
  }

  function okResponse() {
    return { ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve(COMPLETED) }
  }

  /** Ten minutes, matching the OpenAI client's own documented default. */
  it('matches the vendor default rather than inventing a number', () => {
    expect(PROVIDER_REQUEST_TIMEOUT_MS).toBe(600_000)
  })

  it('arms a deadline on a non-streaming request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    await run(fetchMock)

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  /**
   * The runtime's idle timer already bounds a stalled stream correctly. A total deadline
   * here would kill a long answer that is still arriving.
   */
  it('does not arm a deadline on a streaming request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    await run(fetchMock, { stream: true }).catch(() => {})

    const streamCall = fetchMock.mock.calls.find(
      (c) => JSON.parse(c[1].body as string).stream === true
    )
    expect(streamCall).toBeDefined()
    expect(streamCall?.[1].signal).toBeUndefined()
  })

  /** A user pressing Stop must still win over the deadline. */
  it('preserves the caller signal alongside the deadline', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    await run(fetchMock, { abortSignal: controller.signal })

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })
})
