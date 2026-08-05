/**
 * @vitest-environment node
 *
 * A stalled model call surfaces only the runtime's own `TimeoutError: The
 * operation timed out.`, which cannot distinguish "never answered" from
 * "answered but the body never completed" — opposite causes with opposite fixes.
 * These cover the phase annotation that makes the distinction observable from the
 * execution trace, which survives when a task stops shipping logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResponsesProviderRequest } from '@/providers/openai/core'
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

vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

/**
 * Exactly what the runtime raises when a fetch deadline fires: a `DOMException`,
 * NOT a plain `Error`. The distinction is load-bearing — `DOMException.message` is a
 * readonly getter, so annotating by assignment throws a TypeError and replaces the
 * real failure. Constructing a plain Error here would let that regression pass.
 */
function timeoutError() {
  return new DOMException('The operation timed out.', 'TimeoutError')
}

/**
 * A response whose body never settles until the request's signal aborts — the shape of
 * the `/v1/responses` stall. Rejects immediately if the signal already aborted, so the
 * body can never outlive an abort that landed before the listener attached.
 */
function stallingBody(init: RequestInit, responseInit: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    ...responseInit,
    json: () =>
      new Promise((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(timeoutError())
          return
        }
        init.signal?.addEventListener('abort', () => reject(timeoutError()), { once: true })
      }),
  }
}

describe('OpenAI transport phase annotation', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any

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

  it('names the body phase, with response metadata, when headers arrived but the body stalled', async () => {
    const stalledBody = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '32116', 'content-encoding': 'br' }),
      json: () => Promise.reject(timeoutError()),
    }

    await expect(run(vi.fn().mockResolvedValue(stalledBody))).rejects.toThrow(
      /phase=reading-response-body/
    )
  })

  it('carries the status, content-length and content-encoding of the stalled response', async () => {
    const stalledBody = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '32116', 'content-encoding': 'br' }),
      json: () => Promise.reject(timeoutError()),
    }

    const error = await run(vi.fn().mockResolvedValue(stalledBody)).catch((e) => e)
    expect(error.message).toContain('status=200')
    expect(error.message).toContain('contentLength=32116')
    expect(error.message).toContain('contentEncoding=br')
    expect(error.message).toMatch(/ttfbMs=\d+/)
  })

  /**
   * `x-request-id` is the only identifier OpenAI support can trace a call by, and a
   * stalled request is precisely when we need to hand them one.
   */
  it('carries the OpenAI x-request-id of the stalled response', async () => {
    const stalledBody = {
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'req_abc123', 'content-length': '32116' }),
      json: () => Promise.reject(timeoutError()),
    }

    const error = await run(vi.fn().mockResolvedValue(stalledBody)).catch((e) => e)
    expect(error.message).toContain('requestId=req_abc123')
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

  it('names the header phase when nothing came back at all', async () => {
    const error = await run(vi.fn().mockRejectedValue(timeoutError())).catch((e) => e)
    expect(error.message).toContain('phase=awaiting-response-headers')
    // No response existed, so no response metadata may be claimed.
    expect(error.message).not.toContain('status=')
  })

  it('does not retry a stalled body — the endpoint ignores Idempotency-Key, so a retry would double-create', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => Promise.resolve(stallingBody(init)))

    vi.useFakeTimers()
    try {
      const promise = run(fetchMock).catch((e) => e)
      await vi.advanceTimersByTimeAsync(120_000)
      await promise
    } finally {
      vi.useRealTimers()
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(sent['Idempotency-Key']).toBeUndefined()
  })

  it('bounds a stalled body instead of waiting for the runtime socket wall', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => Promise.resolve(stallingBody(init)))

    vi.useFakeTimers()
    let error: any
    try {
      const promise = run(fetchMock).catch((e) => e)
      await vi.advanceTimersByTimeAsync(120_000)
      error = await promise
    } finally {
      vi.useRealTimers()
    }

    expect(error.message).toContain('phase=reading-response-body')
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

  /**
   * The load-bearing design decision. `/v1/responses` withholds its 200 until generation
   * has finished, so all think time is time-to-headers — measured at 14545ms to headers
   * and 1ms of body on a real long call. Bounding headers would therefore fail healthy
   * reasoning runs. If someone later "tidies" the deadline to cover the whole request,
   * this test is what stops it.
   */
  it('does not bound time-to-headers, however long generation takes', async () => {
    const completed = {
      id: 'resp_1',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }
    /**
     * Headers arrive only after far longer than the body budget. The mock honours the
     * signal the way a real fetch does, so a deadline armed before headers would reject
     * here — that is what makes this test able to fail.
     */
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          if (init.signal?.aborted) {
            reject(timeoutError())
            return
          }
          init.signal?.addEventListener('abort', () => reject(timeoutError()), { once: true })
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                headers: new Headers(),
                json: () => Promise.resolve(completed),
              }),
            10 * 60_000
          )
        })
    )

    vi.useFakeTimers()
    try {
      const promise = run(fetchMock)
      await vi.advanceTimersByTimeAsync(11 * 60_000)
      await expect(promise).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not arm the body deadline on a healthy fast response', async () => {
    const completed = {
      id: 'resp_1',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(completed),
    })

    await expect(run(fetchMock)).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The workflow timeout aborts `request.abortSignal` with `DOMException('timeout',
   * 'AbortError')`. It must surface as the caller's abort, never be relabelled as a
   * provider body stall — the two have different owners and different fixes.
   */
  it('surfaces a workflow timeout as an abort, not as a body stall', async () => {
    const workflow = new AbortController()
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      queueMicrotask(() => workflow.abort(new DOMException('timeout', 'AbortError')))
      return Promise.resolve(stallingBody(init))
    })

    const error = await run(fetchMock, { abortSignal: workflow.signal }).catch((e) => e)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(error.message).not.toContain('response body stalled')
  })
})
