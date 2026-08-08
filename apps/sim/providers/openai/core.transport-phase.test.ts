/**
 * @vitest-environment node
 *
 * Covers the phase annotation that separates "never answered" from "answered, but the
 * body never arrived" — the runtime reports both as a bare `TimeoutError`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
import type { ProviderRequest } from '@/providers/types'

const { mockSupportsReasoningEffort } = vi.hoisted(() => ({
  mockSupportsReasoningEffort: vi.fn(() => false),
}))

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
  supportsReasoningEffort: mockSupportsReasoningEffort,
}))

vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

/**
 * Exactly what the runtime raises when a fetch deadline fires: a `DOMException`, NOT a
 * plain `Error`. The distinction is load-bearing — `DOMException.message` is a readonly
 * getter, so annotating by assignment throws a `TypeError` and replaces the real
 * failure. Building a plain `Error` here would let that regression pass.
 */
function timeoutError() {
  return new DOMException('The operation timed out.', 'TimeoutError')
}

const COMPLETED = {
  id: 'resp_1',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
}

describe('OpenAI transport phase annotation', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

  beforeEach(() => {
    vi.clearAllMocks()
    mockSupportsReasoningEffort.mockReturnValue(false)
  })

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

  /**
   * The production case: `/v1/responses` withholds its 200 until generation finishes, so
   * a runaway generation is still in the headers phase when the client gives up.
   */
  it('names the header phase when the request was never answered', async () => {
    const error = await run(vi.fn().mockRejectedValue(timeoutError())).catch((e) => e)

    expect(error.message).toContain('phase=awaiting-response-headers')
    expect(error.message).toMatch(/elapsedMs=\d+/)
    // No response existed, so no response metadata may be claimed.
    expect(error.message).not.toContain('status=')
  })

  it('names the body phase when headers arrived but the body did not', async () => {
    const stalled = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '32116', 'content-encoding': 'br' }),
      json: () => Promise.reject(timeoutError()),
    }

    const error = await run(vi.fn().mockResolvedValue(stalled)).catch((e) => e)

    expect(error.message).toContain('phase=reading-response-body')
    expect(error.message).toContain('status=200')
    expect(error.message).toContain('contentLength=32116')
    expect(error.message).toContain('contentEncoding=br')
    expect(error.message).toMatch(/ttfbMs=\d+/)
  })

  /** The only identifier the provider can trace a failed call by. */
  it('carries the x-request-id of a failed response', async () => {
    const stalled = {
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'req_abc123' }),
      json: () => Promise.reject(timeoutError()),
    }

    const error = await run(vi.fn().mockResolvedValue(stalled)).catch((e) => e)
    expect(error.message).toContain('requestId=req_abc123')
  })

  it('leaves a self-describing API error untouched', async () => {
    const apiError = {
      ok: false,
      status: 429,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'Rate limit reached' } })),
    }

    const error = await run(vi.fn().mockResolvedValue(apiError)).catch((e) => e)
    expect(error.message).toContain('Rate limit reached')
    expect(error.message).not.toContain('phase=')
  })

  it('bounds a non-JSON error body instead of pasting a gateway page into the error', async () => {
    const htmlError = {
      ok: false,
      status: 502,
      headers: new Headers(),
      text: () => Promise.resolve(`<html><body>${'x'.repeat(5000)}</body></html>`),
    }

    const error = await run(vi.fn().mockResolvedValue(htmlError)).catch((e) => e)
    expect(error.message.length).toBeLessThan(700)
  })

  /**
   * The bound applies only to non-JSON bodies. A structured provider error must survive
   * intact, because the reasoning-summary strip-and-retry fallback matches on its text
   * (`message.includes('reasoning.summary')`) — truncating it would silently disable
   * that recovery path for any provider whose error message runs long.
   */
  it('does not truncate a structured provider error, so the summary fallback still matches', async () => {
    // Marker sits past the 500-char bound, so truncation would break the fallback match.
    const longMessage = `${'context detail. '.repeat(40)}Invalid value for reasoning.summary: your organization must be verified to use this feature.`
    expect(longMessage.indexOf('reasoning.summary')).toBeGreaterThan(500)

    const completed = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(COMPLETED),
    }
    const verificationError = {
      ok: false,
      status: 400,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ error: { message: longMessage } })),
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(verificationError)
      .mockResolvedValueOnce(completed)
    // The fallback only applies when the payload actually carried reasoning.summary.
    mockSupportsReasoningEffort.mockReturnValue(true)

    await expect(run(fetchMock, { agentEvents: true })).resolves.toMatchObject({ content: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /**
   * Reading the error body of a non-OK response can itself hit the deadline or be
   * cancelled. Swallowing that would report the HTTP status as the failure and lose both
   * the transport detail and the fact that the user aborted.
   */
  it('propagates a deadline hit while reading a non-OK error body', async () => {
    const unreadable = {
      ok: false,
      status: 502,
      headers: new Headers(),
      text: () => Promise.reject(timeoutError()),
    }

    const error = await run(vi.fn().mockResolvedValue(unreadable)).catch((e) => e)

    expect(error.message).toContain('The operation timed out.')
    expect(error.message).not.toContain('API error')
    // The headers already arrived, so this is the body phase despite the 4xx/5xx status.
    expect(error.message).toContain('phase=reading-response-body')
    expect(error.message).toContain('status=502')
    // Annotated exactly once: the outer catch must not append a second, wrong phase.
    expect(error.message.match(/phase=/g)).toHaveLength(1)
  })

  /**
   * Streaming calls the request helper directly and never reaches `postResponses`, so a
   * header stall on a chat or SSE run used to surface as the bare runtime string with no
   * phase, elapsed time, or request id.
   */
  it('names the header phase on a streaming request too', async () => {
    const error = await run(vi.fn().mockRejectedValue(timeoutError()), {
      stream: true,
    }).catch((e) => e)

    expect(error.message).toContain('phase=awaiting-response-headers')
    expect(error.message).toMatch(/elapsedMs=\d+/)
  })

  it('leaves a healthy response entirely unaffected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(COMPLETED),
    })

    await expect(run(fetchMock)).resolves.toMatchObject({ content: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
