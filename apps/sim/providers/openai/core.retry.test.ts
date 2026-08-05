/**
 * @vitest-environment node
 *
 * `/v1/responses` is posted with raw `fetch`, which dropped the OpenAI SDK's own
 * `maxRetries: 2` when this path moved off the SDK. These cover the restored
 * status-based retries — and, just as importantly, the classes that must stay
 * non-retryable: a caller abort, and a stalled body, which arrives only after a
 * response already exists and would therefore be billed twice.
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

const COMPLETED_RESPONSE = {
  id: 'resp_1',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(COMPLETED_RESPONSE),
  }
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(JSON.stringify({ error: { message: `boom ${status}` } })),
  }
}

/**
 * Exactly what the runtime raises when a fetch deadline fires: a `DOMException`,
 * NOT a plain `Error`. `DOMException.message` is a readonly getter, so a plain
 * `Error` here would not exercise the real failure shape.
 */
function timeoutError() {
  return new DOMException('The operation timed out.', 'TimeoutError')
}

/** A 200 whose body never settles until the request's signal aborts. */
function stallingBody(init: RequestInit) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
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

describe('OpenAI Responses status retries', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

  beforeEach(() => vi.clearAllMocks())

  function run(fetchMock: unknown, request: Partial<ProviderRequest> = {}) {
    return executeResponsesProviderRequest(
      {
        apiKey: 'k',
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'hi' }],
        workflowId: 'wf_1',
        blockId: 'blk_1',
        executionId: 'exec_1',
        ...request,
      },
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
   * Drives a run to completion under fake timers so backoff costs no wall time.
   *
   * Timers are restored on a single exit path rather than in a `finally` after a
   * `return`: biome reads `vi.useRealTimers` as a React hook and rejects that shape
   * as a conditionally-called hook.
   */
  async function runWithTimers(fetchMock: unknown, request: Partial<ProviderRequest> = {}) {
    vi.useFakeTimers()
    const promise = run(fetchMock, request).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(120_000)
    const settled = await promise
    vi.useRealTimers()
    return settled
  }

  it('retries a 429 and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse())

    const result = await runWithTimers(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'ok' })
  })

  it('retries a 500 and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(okResponse())

    const result = await runWithTimers(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ content: 'ok' })
  })

  it('logs each retry with the attempt, status, delay and correlation ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse())

    await runWithTimers(fetchMock)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('retryable status'),
      expect.objectContaining({
        attempt: 1,
        status: 503,
        delayMs: expect.any(Number),
        workflowId: 'wf_1',
        blockId: 'blk_1',
        executionId: 'exec_1',
      })
    )
  })

  it('does not retry a 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400))

    const error = await runWithTimers(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((error as Error).message).toContain('boom 400')
  })

  it('does not retry a 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401))

    const error = await runWithTimers(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((error as Error).message).toContain('boom 401')
  })

  it('gives up after the maximum attempts and surfaces the final error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(429))

    const error = await runWithTimers(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect((error as Error).message).toContain('OpenAI API error (429): boom 429')
  })

  it('honours Retry-After before re-sending', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { 'retry-after': '5' }))
      .mockResolvedValueOnce(okResponse())

    vi.useFakeTimers()
    try {
      const promise = run(fetchMock).catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(4_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1_500)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1_000)
      await promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefers retry-after-ms over Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { 'retry-after-ms': '8000', 'retry-after': '1' }))
      .mockResolvedValueOnce(okResponse())

    vi.useFakeTimers()
    try {
      const promise = run(fetchMock).catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(7_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1_500)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1_000)
      await promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a stalled error body instead of hanging on it', async () => {
    // Non-2xx headers, then an error body that never settles.
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => ({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: () =>
        new Promise<string>((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new DOMException('The operation timed out.', 'TimeoutError'))
            return
          }
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation timed out.', 'TimeoutError')),
            { once: true }
          )
        }),
    }))

    const settled = await runWithTimers(fetchMock)

    expect(settled).toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('abandons backoff immediately when the caller aborts, and reports the abort', async () => {
    const caller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => {
      queueMicrotask(() => caller.abort(new DOMException('timeout', 'AbortError')))
      return errorResponse(429)
    })

    const settled = (await runWithTimers(fetchMock, { abortSignal: caller.signal })) as Error

    // The cancellation must surface as the abort, not as the stale 429.
    expect(settled.message).not.toContain('429')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the caller aborts', async () => {
    const caller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => {
      caller.abort(new DOMException('workflow cancelled', 'AbortError'))
      return Promise.resolve(errorResponse(429))
    })

    await runWithTimers(fetchMock, { abortSignal: caller.signal })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The double-billing guard. A stalled body means the response was created and
   * billed server-side; `/v1/responses` ignores `Idempotency-Key`, so re-sending
   * would generate and bill a second one.
   */
  it('does not retry a body stall', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => Promise.resolve(stallingBody(init)))

    const error = await runWithTimers(fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((error as Error).message).toContain('phase=reading-response-body')
  })
})
