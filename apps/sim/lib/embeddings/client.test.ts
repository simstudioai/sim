/**
 * @vitest-environment node
 */

import { resetEnvMock, setEnv } from '@sim/testing'
import { interruptibleSleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertKnowledgeEmbeddingCapacityForDeployment,
  clampEmbeddingConcurrency,
  EMBEDDING_MAX_RETRIES,
  EmbeddingAPIError,
  EmbeddingOutputLimitError,
  EmbeddingQuotaExhaustedError,
  embed,
  embedKnowledgeForDeployment,
  embedOpenRouter,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
  isTransientEmbeddingError,
  MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
} from '@/lib/embeddings/client'

const { mockGetBYOKKey } = vi.hoisted(() => ({
  mockGetBYOKKey: vi.fn(),
}))

const { quotaGates, mockAdmit, mockCooldown, mockQuotaCheck } = vi.hoisted(() => ({
  quotaGates: new Set<string>(),
  mockAdmit: vi.fn(),
  mockCooldown: vi.fn(),
  mockQuotaCheck: vi.fn(),
}))
vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  waitForProviderAdmission: mockAdmit,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  isProviderQuotaExhausted: mockQuotaCheck,
  recordProviderCooldown: mockCooldown,
}))

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: mockGetBYOKKey,
}))

/**
 * Exercises the orchestrator end-to-end against a mocked transport: batching,
 * per-provider item caps, input ordering, dimension resolution, and retry.
 * Every call passes an explicit `apiKey` so BYOK/env/rotating-pool resolution
 * (which needs a database) is bypassed.
 */

const originalFetch = global.fetch

function jsonResponse(body: unknown, status = 200, responseHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: String(status),
    headers: new Headers(responseHeaders),
  })
}

function rawJsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    statusText: String(status),
    headers: new Headers({ 'content-type': 'application/json' }),
  })
}

function sizedVector(values: number[], dimensions: number): number[] {
  return [...values, ...Array(Math.max(0, dimensions - values.length)).fill(0)].slice(0, dimensions)
}

function openAIBody(vectors: number[][], totalTokens = 5, dimensions: number | null = 1536) {
  return {
    data: vectors.map((embedding) => ({
      embedding: dimensions === null ? embedding : sizedVector(embedding, dimensions),
    })),
    usage: { total_tokens: totalTokens },
  }
}

function oversizedChunkedSuccessResponse(): Response {
  const chunkBytes = 1024 * 1024
  const chunk = new Uint8Array(chunkBytes).fill(0x20)
  const chunkCount = Math.floor(MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES / chunkBytes) + 1
  let emitted = 0

  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= chunkCount) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
        emitted++
      },
    }),
    { status: 200 }
  )
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockQuotaCheck
    .mockReset()
    .mockImplementation(async (identity: { credentialFingerprint: string }) =>
      quotaGates.has(identity.credentialFingerprint)
    )
  mockAdmit.mockReset().mockResolvedValue(undefined)
  mockCooldown.mockReset()
  mockCooldown.mockImplementation(
    async (identity: { credentialFingerprint: string }, _waitMs: number, quota: boolean) => {
      if (quota) quotaGates.add(identity.credentialFingerprint)
    }
  )

  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  mockGetBYOKKey.mockResolvedValue(null)
  setEnv({
    AZURE_OPENAI_API_KEY: undefined,
    AZURE_OPENAI_ENDPOINT: undefined,
    AZURE_OPENAI_API_VERSION: undefined,
    GEMINI_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_API_KEY_1: undefined,
    OPENAI_API_KEY_2: undefined,
    OPENAI_API_KEY_3: undefined,
    OPENROUTER_API_KEY: undefined,
    OLLAMA_URL: undefined,
  })
})

afterEach(() => {
  quotaGates.clear()
  global.fetch = originalFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetEnvMock()
})

describe('embedding cancellation', () => {
  it('cancels a stalled response body after headers arrive without retrying', async () => {
    vi.useFakeTimers()
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody })))
    const controller = new AbortController()
    const pending = embed(['text'], { apiKey: 'key', signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('cancelled'))
    await rejected
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends stalled admission at the overall deadline without sending a provider request', async () => {
    vi.useFakeTimers()
    mockAdmit.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = embed(['text'], { apiKey: 'key' })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(150_000)
    await rejected
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockAdmit).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares the same deadline between admission and a stalled response body', async () => {
    vi.useFakeTimers()
    mockAdmit.mockImplementationOnce(() => interruptibleSleep(120_000))
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody })))
    const pending = embed(['text'], { apiKey: 'key' })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(149_999)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancelBody).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(mockAdmit).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a fallback provider after cancellation', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-key', OPENROUTER_API_KEY: 'router-key' })
    fetchMock.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
    const controller = new AbortController()
    const pending = embedKnowledgeForDeployment(['text'], { signal: controller.signal }, false)
    const rejected = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('embed', () => {
  it('sends one request for a small batch and returns its vectors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2, 3]], 4)))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      input: ['hello'],
      model: 'text-embedding-3-small',
    })
    expect(result.embeddings[0].slice(0, 3)).toEqual([1, 2, 3])
    expect(result.embeddings[0]).toHaveLength(1536)
    expect(result.totalTokens).toBe(4)
    expect(result.dimensions).toBe(1536)
    expect(result.pricingId).toBe('text-embedding-3-small')
  })

  it("splits past Gemini's 100-item cap and preserves input order across batches", async () => {
    const inputs = Array.from({ length: 250 }, (_, i) => `text-${i}`)
    let cursor = 0

    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const count = body.requests.length
      // Each vector encodes its global input index so ordering is verifiable.
      const embeddings = Array.from({ length: count }, (_, i) => ({
        values: sizedVector([cursor + i], 3072),
      }))
      cursor += count
      return jsonResponse({ embeddings })
    })

    const result = await embed(inputs, {
      model: 'gemini-embedding-001',
      apiKey: 'g-test',
      taskType: 'document',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const sentCounts = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).requests.length
    )
    expect(sentCounts).toEqual([100, 100, 50])
    expect(result.embeddings).toHaveLength(250)
    // Native dimensionality means no reduction, so values pass through unnormalized.
    expect(result.embeddings.map((v) => v[0])).toEqual(inputs.map((_, i) => i))
  })

  it('estimates tokens when the provider omits usage', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ embeddings: [{ values: sizedVector([1, 2], 3072) }] })
    )

    const result = await embed(['some text to embed'], {
      model: 'gemini-embedding-001',
      apiKey: 'g-test',
    })

    expect(result.totalTokens).toBeGreaterThan(0)
  })

  it("bills Gemini on its reported token count rather than tiktoken's guess", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        embeddings: [{ values: sizedVector([1, 2], 3072) }],
        usageMetadata: { promptTokenCount: 4321 },
      })
    )

    const result = await embed(['some text to embed'], {
      model: 'gemini-embedding-001',
      apiKey: 'g-test',
    })

    expect(result.totalTokens).toBe(4321)
  })

  it('splits a long input list into several bounded requests', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return jsonResponse(openAIBody(body.input.map(() => [1])))
    })

    /**
     * 40 inputs of roughly 500 tokens each exceed the batch target several times
     * over, so they must be spread across requests rather than sent as one.
     * Every input still has to arrive exactly once, in order.
     */
    const inputs = Array.from({ length: 40 }, (_, i) => `${i} ${'word '.repeat(500)}`)
    const result = await embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    const sent = fetchMock.mock.calls.flatMap(
      ([, init]) => JSON.parse((init as RequestInit).body as string).input as string[]
    )
    expect(sent).toEqual(inputs)
    expect(result.embeddings).toHaveLength(40)
  })

  it('splits max-dimension batches to the successful-response byte budget and preserves order', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const inputs = body.input as string[]
      return jsonResponse(
        openAIBody(
          inputs.map((input) => [Number(input.slice(1))]),
          inputs.length,
          3072
        )
      )
    })
    const inputs = Array.from({ length: 400 }, (_, index) => `i${index}`)

    const result = await embed(inputs, {
      model: 'text-embedding-3-large',
      apiKey: 'sk-test',
    })

    expect(
      fetchMock.mock.calls.map(
        ([, init]) => JSON.parse((init as RequestInit).body as string).input.length
      )
    ).toEqual([169, 169, 62])
    expect(result.embeddings.map(([value]) => value)).toEqual(
      inputs.map((input) => Number(input.slice(1)))
    )
  })

  it('keeps a long Cohere input whole rather than cutting it to the batch budget', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return jsonResponse({
        embeddings: { float: body.texts.map(() => sizedVector([1], 1536)) },
        meta: { billed_units: { input_tokens: 1 } },
      })
    })

    /**
     * Cohere accepts 128k tokens in one text — far above the conservative
     * default request budget. That budget floors at the per-input ceiling, or
     * this input would be silently cut to a fraction of its length.
     */
    const long = 'word '.repeat(30_000)
    await embed([long], { model: 'embed-v4.0', apiKey: 'co-test' })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.texts[0]).toBe(long)
  })

  it('forwards a supported dimension reduction and reports it back', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 5, 1024)))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-large',
      apiKey: 'sk-test',
      dimensions: 1024,
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.dimensions).toBe(1024)
    expect(result.dimensions).toBe(1024)
  })

  /**
   * Regression: the resolved dimensionality is reported back to the caller but
   * must not reach the wire unless the caller asked to reduce. `ada-002` and
   * `mistral-embed` reject the parameter outright, so sending it populated with
   * the native size made every unreduced request to those models a 400.
   */
  it('omits the dimension field when no reduction was requested', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    const result = await embed(['hello'], {
      model: 'text-embedding-ada-002',
      apiKey: 'sk-test',
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).not.toHaveProperty('dimensions')
    expect(result.dimensions).toBe(1536)
  })

  it('omits the dimension field for a model without Matryoshka support', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [{ embedding: sizedVector([1, 2], 1024), index: 0 }],
        usage: { total_tokens: 5 },
      })
    )

    const result = await embed(['hello'], { model: 'mistral-embed', apiKey: 'key-test' })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).not.toHaveProperty('output_dimension')
    expect(result.dimensions).toBe(1024)
  })

  it('rejects an unsupported dimension before making a request', async () => {
    await expect(
      embed(['hello'], { model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 999 })
    ).rejects.toThrow(/does not support 999/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown model before making a request', async () => {
    await expect(embed(['hello'], { model: 'nope', apiKey: 'sk-test' })).rejects.toThrow(
      'Unsupported embedding model: nope'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a non-retryable provider error with its status', async () => {
    const echoedSecret = 'sk-provider-echoed-secret'
    fetchMock.mockResolvedValue(jsonResponse({ error: `bad key: ${echoedSecret}` }, 401))

    const error = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-bad',
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Embedding API failed: 401/)
    expect((error as Error).message).not.toContain(echoedSecret)
    expect(isBYOKEmbeddingCredentialRejection(error)).toBe(true)
    // 401 is not retryable, so exactly one attempt is made.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized chunked success response before JSON materialization', async () => {
    fetchMock.mockResolvedValue(oversizedChunkedSuccessResponse())

    await expect(
      embed(['hello'], { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      label: 'Embedding API success response',
      maxBytes: MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'the wrong number of vectors',
      inputs: ['alpha', 'beta'],
      body: openAIBody([[1]], 2),
      message: 'returned 1 embeddings for 2 inputs',
    },
    {
      name: 'an empty vector',
      inputs: ['alpha'],
      body: openAIBody([[]], 1, null),
      message: 'vector 0 is empty or not an array',
    },
    {
      name: 'a vector with the wrong catalog dimension',
      inputs: ['alpha'],
      body: openAIBody([[1, 2]], 1, null),
      message: 'vector 0 has 2 unexpected dimensions; expected 1536',
    },
    {
      name: 'a vector with a nonnumeric coordinate',
      inputs: ['alpha'],
      body: { data: [{ embedding: [1, 'invalid'] }], usage: { total_tokens: 1 } },
      message: 'vector 0 contains a non-numeric or non-finite coordinate',
    },
    {
      name: 'an unparseable vector envelope',
      inputs: ['alpha'],
      body: { data: {}, usage: { total_tokens: 1 } },
      message: 'the vector payload could not be parsed',
    },
  ])('rejects a valid-JSON success body containing $name', async ({ inputs, body, message }) => {
    fetchMock.mockResolvedValue(jsonResponse(body))

    await expect(
      embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'EmbeddingResponseValidationError',
      message: expect.stringContaining(message),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a valid-JSON success body containing a non-finite coordinate', async () => {
    fetchMock.mockResolvedValue(
      rawJsonResponse('{"data":[{"embedding":[1e999]}],"usage":{"total_tokens":1}}')
    )

    await expect(
      embed(['alpha'], { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'EmbeddingResponseValidationError',
      message: expect.stringContaining('non-numeric or non-finite coordinate'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects one malformed concurrent batch after admitting all independent batches', async () => {
    const inputs = Array.from({ length: 3 }, (_, index) => `i${index} ${'word '.repeat(5000)}`)
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const input = (body.input as string[])[0]
      return input.startsWith('i1')
        ? jsonResponse({ data: [], usage: { total_tokens: 1 } })
        : jsonResponse(openAIBody([[Number(input[1])]], 1))
    })

    await expect(
      embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'EmbeddingResponseValidationError',
      message: expect.stringContaining('returned 0 embeddings for 1 inputs'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('preserves input order when concurrent batches complete out of order', async () => {
    const inputs = Array.from({ length: 3 }, (_, index) => `i${index} ${'word '.repeat(5000)}`)
    const responders = new Map<string, (response: Response) => void>()
    fetchMock.mockImplementation(
      async (_url, init) =>
        new Promise<Response>((resolve) => {
          const body = JSON.parse((init as RequestInit).body as string)
          const input = (body.input as string[])[0]
          responders.set(input.slice(0, 2), resolve)
        })
    )

    const pending = embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    for (const index of [2, 1, 0]) {
      responders.get(`i${index}`)?.(jsonResponse(openAIBody([[index]], 1)))
    }
    const result = await pending

    expect(result.embeddings.map(([value]) => value)).toEqual([0, 1, 2])
  })

  it('retries a rate-limited request and succeeds on a later attempt', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse(openAIBody([[7, 8]])))

    const pending = embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings[0].slice(0, 2)).toEqual([7, 8])
  })

  it('marks a caller-supplied key as BYOK so Sim does not bill for it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1]])))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-user-owned',
    })

    expect(result.isBYOK).toBe(true)
    expect(result.billableTokens).toBe(0)
  })

  it('uses OpenRouter as an explicit transport for an OpenAI catalog model', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 5, 1024)))

    await embed(['hello'], {
      model: 'text-embedding-3-large',
      transport: 'openrouter',
      apiKey: 'or-test',
      dimensions: 1024,
      projectInputs: null,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'openai/text-embedding-3-large',
      dimensions: 1024,
    })
  })

  /**
   * `batchByTokenLimit` truncates any single text above the limit it is given,
   * so the limit has to be the selected model's own. One shared constant sent
   * oversized input to the models with a lower ceiling and silently dropped
   * content the models with a higher one would have accepted.
   */
  describe('per-model token limits', () => {
    it("truncates against Gemini's lower ceiling rather than a shared constant", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ embeddings: [{ values: sizedVector([1], 3072) }] })
      )
      // ~10k tokens: over Gemini's 2048 ceiling, but under the old 8000 constant,
      // so this used to reach the provider whole and come back a 502.
      const long = 'word '.repeat(8000)

      await embed([long], { model: 'gemini-embedding-001', apiKey: 'g-test' })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      const sent = body.requests[0].content.parts[0].text
      expect(sent.length).toBeLessThan(long.length)
    })

    it("keeps text intact up to Cohere's much higher ceiling", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          embeddings: { float: [sizedVector([1], 1536)] },
          meta: { billed_units: { input_tokens: 9 } },
        })
      )
      // Over the old 8000 constant, well under Cohere's 128k, so it must survive.
      const long = 'word '.repeat(8000)

      await embed([long], { model: 'embed-v4.0', apiKey: 'c-test' })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.texts[0]).toBe(long)
    })
  })

  /**
   * The knowledge-base path rewrites resolved-secret plaintext back to
   * placeholders before inputs reach a provider. The block path projects
   * earlier, at the tool's HTTP hop, and passes null here so the substitution
   * does not run twice over already-projected content.
   */
  describe('resolved-secret projection', () => {
    it('sends projected inputs, not the originals', async () => {
      fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1], [2]])))

      await embed(['token is sk-live-123', 'harmless'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs: (values) => values.map((v) => v.replace('sk-live-123', '{{API_KEY}}')),
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.input).toEqual(['token is {{API_KEY}}', 'harmless'])
      expect(JSON.stringify(body)).not.toContain('sk-live-123')
    })

    it('leaves inputs untouched when the caller passes null', async () => {
      fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1]])))

      await embed(['already projected'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs: null,
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.input).toEqual(['already projected'])
    })

    it('estimates tokens from the projected values, not the originals', async () => {
      // Gemini omits usage, so the token count is estimated from what was sent.
      fetchMock.mockResolvedValue(
        jsonResponse({ embeddings: [{ values: sizedVector([1, 2, 3], 3072) }] })
      )

      const result = await embed(['x'.repeat(400)], {
        model: 'gemini-embedding-001',
        apiKey: 'key-test',
        projectInputs: () => ['tiny'],
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.requests[0].content.parts[0].text).toBe('tiny')
      // 400 chars would estimate far higher; 'tiny' lands in single digits.
      expect(result.totalTokens).toBeLessThan(10)
    })

    /**
     * Projection changes length, and batching truncates whatever it measures.
     * Batching the pre-projection text sized against a string that was never
     * sent: a lengthening projection then exceeded the model's ceiling, and a
     * shortening one discarded content that would have fit.
     */
    it('batches the projected text, not the original', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ embeddings: [{ values: sizedVector([1], 3072) }] })
      )
      // Under Gemini's 2048 ceiling before projection, far over it after.
      const short = 'secret'

      await embed([short], {
        model: 'gemini-embedding-001',
        apiKey: 'g-test',
        projectInputs: () => ['word '.repeat(8000)],
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      const sent = body.requests[0].content.parts[0].text
      // Truncated against the model ceiling, so the lengthened text cannot go out whole.
      expect(sent.length).toBeLessThan('word '.repeat(8000).length)
    })

    it('projects once even when the request is retried', async () => {
      vi.useFakeTimers()
      const projectInputs = vi.fn((values: readonly string[]) => values.map(() => 'projected'))
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
        .mockResolvedValueOnce(jsonResponse(openAIBody([[1]])))

      const pending = embed(['secret'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs,
      })
      await vi.runAllTimersAsync()
      await pending

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(projectInputs).toHaveBeenCalledTimes(1)
    })
  })
})

describe('embedOpenRouter', () => {
  it('uses a dynamic model and reports the returned native dimensions', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const inputs = body.input as string[]
      return jsonResponse(
        openAIBody(
          inputs.map((input) => (input === 'alpha' ? [1, 2, 3] : [4, 5, 6])),
          inputs[0] === 'alpha' ? 3 : 4,
          null
        )
      )
    })

    const result = await embedOpenRouter(['alpha', 'beta'], {
      model: 'openrouter/qwen/qwen3-embedding-8b',
      apiKey: 'or-test',
      maxInputTokens: 32768,
      projectInputs: null,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      input: ['alpha'],
      model: 'qwen/qwen3-embedding-8b',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    ).not.toHaveProperty('dimensions')
    expect(result).toMatchObject({
      embeddings: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      dimensions: 3,
      totalTokens: 7,
      billableTokens: 0,
      isBYOK: true,
      modelName: 'openrouter/qwen/qwen3-embedding-8b',
    })
  })

  it('fails when OpenRouter returns the wrong number of vectors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 5, null)))

    await expect(
      embedOpenRouter(['alpha', 'beta'], {
        model: 'openrouter/qwen/qwen3-embedding-8b',
        apiKey: 'or-test',
        maxInputTokens: 32768,
        dimensions: 2,
        projectInputs: null,
      })
    ).rejects.toThrow('returned 1 embeddings for 2 inputs')
  })

  it('fails when OpenRouter returns inconsistent vector dimensions', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(openAIBody([[1, 2]], 1, null)))
      .mockResolvedValueOnce(jsonResponse(openAIBody([[3, 4], [5]], 2, null)))

    await expect(
      embedOpenRouter(['alpha', 'beta', 'gamma'], {
        model: 'openrouter/qwen/qwen3-embedding-8b',
        apiKey: 'or-test',
        maxInputTokens: 32768,
        projectInputs: null,
      })
    ).rejects.toThrow('vector 1 has 1 unexpected dimensions; expected 2')
  })

  it('fails when OpenRouter violates an explicitly requested dimension', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 5, null)))

    await expect(
      embedOpenRouter(['alpha'], {
        model: 'openrouter/qwen/qwen3-embedding-8b',
        apiKey: 'or-test',
        maxInputTokens: 32768,
        dimensions: 3,
        projectInputs: null,
      })
    ).rejects.toThrow('vector 0 has 2 unexpected dimensions; expected 3')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a dynamic-model batch that differs from the learned dimension', async () => {
    const inputs = Array.from({ length: 2049 }, (_, index) => `i${index}`)
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const batch = body.input as string[]
      const embedding = batch.length === 1 ? [2, 3, 4] : [1, 3]
      return jsonResponse(
        openAIBody(
          batch.map(() => embedding),
          batch.length,
          null
        )
      )
    })

    await expect(
      embedOpenRouter(inputs, {
        model: 'openrouter/qwen/qwen3-embedding-8b',
        apiKey: 'or-test',
        maxInputTokens: 32768,
        projectInputs: null,
      })
    ).rejects.toThrow('vector 0 has 2 unexpected dimensions; expected 3')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats OpenRouter HTTP 402 as exhausted credit and opens the circuit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Payment required' } }, 402))

    const options = {
      model: 'openrouter/qwen/qwen3-embedding-8b',
      apiKey: 'or-exhausted',
      maxInputTokens: 32768,
      projectInputs: null,
    } as const

    await expect(embedOpenRouter(['alpha'], options)).rejects.toEqual(
      expect.objectContaining({ name: 'EmbeddingQuotaExhaustedError', status: 402 })
    )
    await expect(embedOpenRouter(['beta'], options)).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('truncates inputs to the selected model context length', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 5, null)))

    await embedOpenRouter(['alpha beta gamma'], {
      model: 'openrouter/thenlper/gte-base',
      apiKey: 'or-test',
      maxInputTokens: 1,
      projectInputs: null,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.input).toHaveLength(1)
    expect(body.input[0]).not.toBe('alpha beta gamma')
  })

  it('splits dynamic models at the provider item limit and recombines in order', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const inputs = body.input as string[]
      return jsonResponse(
        openAIBody(
          inputs.map((input) => [Number(input.slice(1))]),
          inputs.length,
          null
        )
      )
    })
    const inputs = Array.from({ length: 2049 }, (_, index) => `i${index}`)

    const result = await embedOpenRouter(inputs, {
      model: 'openrouter/qwen/qwen3-embedding-8b',
      apiKey: 'or-test',
      maxInputTokens: 32768,
      projectInputs: null,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls
        .map(([, init]) => JSON.parse((init as RequestInit).body as string).input.length)
        .sort((a, b) => a - b)
    ).toEqual([1, 2048])
    expect(result.embeddings).toHaveLength(2049)
    expect(result.embeddings[0]).toEqual([0])
    expect(result.embeddings[2048]).toEqual([2048])
  })

  it('learns a dynamic model dimension before response-safe batching', async () => {
    const dimensions = 32_768
    const inputs = Array.from({ length: 17 }, (_, index) => `i${index}`)
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const batch = body.input as string[]
      return jsonResponse(
        openAIBody(
          batch.map((input) => sizedVector([Number(input.slice(1))], dimensions)),
          batch.length,
          null
        )
      )
    })

    const result = await embedOpenRouter(inputs, {
      model: 'openrouter/example/high-dimensional-model',
      apiKey: 'or-test',
      maxInputTokens: 32768,
      projectInputs: null,
    })

    expect(
      fetchMock.mock.calls
        .map(([, init]) => JSON.parse((init as RequestInit).body as string).input.length)
        .sort((a, b) => a - b)
    ).toEqual([1, 1, 15])
    expect(result.dimensions).toBe(dimensions)
    expect(result.embeddings.map(([first]) => first)).toEqual(
      Array.from({ length: 17 }, (_, index) => index)
    )
  })

  it('rejects an oversized dynamic aggregate after discovery and before fan-out', async () => {
    const dimensions = 32_768
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([sizedVector([1], dimensions)], 1, null)))

    await expect(
      embedOpenRouter(
        Array.from({ length: 100 }, (_, index) => `i${index}`),
        {
          model: 'openrouter/example/high-dimensional-model',
          apiKey: 'or-test',
          maxInputTokens: 32768,
          projectInputs: null,
        }
      )
    ).rejects.toThrow('Embedding output')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized explicit-dimension aggregate before making a request', async () => {
    await expect(
      embedOpenRouter(
        Array.from({ length: 1000 }, (_, index) => `i${index}`),
        {
          model: 'openrouter/example/high-dimensional-model',
          apiKey: 'or-test',
          maxInputTokens: 32768,
          dimensions: 4096,
          projectInputs: null,
        }
      )
    ).rejects.toThrow('Embedding output')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('embedding concurrency admission', () => {
  it.each([
    [Number.NaN, 8],
    [0, 1],
    [-10, 1],
    [4.9, 4],
    [10_000, 16],
  ])('clamps %s to %s', (configured, expected) => {
    expect(clampEmbeddingConcurrency(configured)).toBe(expected)
  })
})

describe('knowledge embedding transport fallback', () => {
  const options = {
    model: 'text-embedding-3-small',
    taskType: 'document' as const,
    dimensions: 1536,
    projectInputs: null,
  }

  it('uses OpenRouter when it is the only configured self-hosted transport', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 3)))

    const result = await embedKnowledgeForDeployment(['hello'], options, false)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
    })
    expect(result).toMatchObject({
      billableTokens: 3,
      isBYOK: false,
      modelName: 'text-embedding-3-small',
      dimensions: 1536,
    })
    expect(result.embeddings[0].slice(0, 2)).toEqual([1, 2])
    expect(result.embeddings[0]).toHaveLength(1536)
  })

  it('rejects aggregate output above the safe limit before selecting a transport', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-test' })
    const texts = Array.from({ length: 5000 }, (_, index) => `input-${index}`)
    const projectInputs = vi.fn((inputs: string[]) => inputs)

    await expect(
      embedKnowledgeForDeployment(texts, { ...options, projectInputs }, false)
    ).rejects.toBeInstanceOf(EmbeddingOutputLimitError)
    expect(projectInputs).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the original OpenAI path when OpenRouter is not configured', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    await embedKnowledgeForDeployment(['hello'], options, false)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/embeddings')
  })

  it('uses Azure before OpenAI and OpenRouter when all are configured', async () => {
    setEnv({
      AZURE_OPENAI_API_KEY: 'azure-test',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_VERSION: '2024-10-21',
      KB_OPENAI_MODEL_NAME: 'kb-embedding-deployment',
      OPENAI_API_KEY: 'openai-test',
      OPENROUTER_API_KEY: 'or-test',
    })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    const result = await embedKnowledgeForDeployment(['hello'], options, false)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.openai.azure.com/openai/deployments/kb-embedding-deployment/embeddings?api-version=2024-10-21'
    )
    expect(result.modelName).toBe('kb-embedding-deployment')
  })

  it('uses a workspace OpenAI key before OpenRouter', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-test' })
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'workspace-openai-test', isBYOK: true })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    const result = await embedKnowledgeForDeployment(
      ['hello'],
      { ...options, workspaceId: 'workspace-1' },
      false
    )

    expect(mockGetBYOKKey).toHaveBeenCalledWith('workspace-1', 'openai')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer workspace-openai-test',
    })
    expect(result.isBYOK).toBe(true)
  })

  it('distinguishes workspace credential rejection from a platform credential failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, 401))

    setEnv({ OPENAI_API_KEY: 'platform-openai-test' })
    const platformError = await embedKnowledgeForDeployment(['hello'], options, true).catch(
      (error) => error
    )
    expect(isBYOKEmbeddingCredentialRejection(platformError)).toBe(false)

    mockGetBYOKKey.mockResolvedValue({ apiKey: 'workspace-openai-test', isBYOK: true })
    const workspaceError = await embedKnowledgeForDeployment(
      ['hello'],
      { ...options, workspaceId: 'workspace-1' },
      true
    ).catch((error) => error)
    expect(isBYOKEmbeddingCredentialRejection(workspaceError)).toBe(true)
  })

  it('does not use OpenRouter for non-OpenAI knowledge models', async () => {
    setEnv({ GEMINI_API_KEY: 'gemini-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockResolvedValue(
      jsonResponse({ embeddings: [{ values: sizedVector([1, 2], 1536) }] })
    )

    await embedKnowledgeForDeployment(
      ['hello'],
      { ...options, model: 'gemini-embedding-001' },
      false
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
  })

  it('ignores OpenRouter on hosted deployments', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    await embedKnowledgeForDeployment(['hello'], options, true)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/embeddings')
  })

  it('does not fall back after a fatal provider error', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, 401))

    await expect(embedKnowledgeForDeployment(['hello'], options, false)).rejects.toThrow(
      /Embedding API failed: 401/
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back once when a provider returns a malformed success body', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockImplementation(async (url) =>
      url === 'https://api.openai.com/v1/embeddings'
        ? jsonResponse({ data: [], usage: { total_tokens: 1 } })
        : jsonResponse(openAIBody([[7, 8]], 2))
    )

    const result = await embedKnowledgeForDeployment(['hello'], options, false)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.com/v1/embeddings',
      'https://openrouter.ai/api/v1/embeddings',
    ])
    expect(result.embeddings[0].slice(0, 2)).toEqual([7, 8])
  })

  it('falls back immediately when the first provider credential has exhausted credit', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockImplementation(async (url) =>
      url === 'https://api.openai.com/v1/embeddings'
        ? jsonResponse({ error: { type: 'insufficient_quota', code: 'insufficient_quota' } }, 429)
        : jsonResponse(openAIBody([[7, 8]], 2))
    )

    const result = await embedKnowledgeForDeployment(['hello'], options, false)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.com/v1/embeddings',
      'https://openrouter.ai/api/v1/embeddings',
    ])
    expect(result.embeddings[0].slice(0, 2)).toEqual([7, 8])
  })

  it('falls back after transient retries and projects inputs only once', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    const projectInputs = vi.fn(() => ['projected'])
    fetchMock.mockImplementation(async (url) =>
      url === 'https://api.openai.com/v1/embeddings'
        ? jsonResponse({ error: 'unavailable' }, 503)
        : jsonResponse(openAIBody([[7, 8]], 2))
    )

    const pending = embedKnowledgeForDeployment(['secret'], { ...options, projectInputs }, false)
    await vi.runAllTimersAsync()
    const result = await pending

    const attempts = EMBEDDING_MAX_RETRIES + 1
    expect(fetchMock).toHaveBeenCalledTimes(attempts + 1)
    expect(
      fetchMock.mock.calls.slice(0, attempts).every(([url]) => url.includes('api.openai.com'))
    ).toBe(true)
    expect(fetchMock.mock.calls[attempts][0]).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(projectInputs).toHaveBeenCalledOnce()
    expect(result.embeddings[0].slice(0, 2)).toEqual([7, 8])
  })

  it('falls back only the failed batch and retains successful provider work', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'workspace-openai-test', isBYOK: true })
    const firstInput = `first ${'word '.repeat(5000)}`
    const secondInput = `second ${'word '.repeat(5000)}`
    fetchMock.mockImplementation(async (url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const input = body.input[0] as string
      if (url === 'https://api.openai.com/v1/embeddings' && input.startsWith('second')) {
        return jsonResponse({ error: 'unavailable' }, 503)
      }
      return jsonResponse(openAIBody([[input.startsWith('first') ? 1 : 2]], 3))
    })

    const pending = embedKnowledgeForDeployment(
      [firstInput, secondInput],
      { ...options, workspaceId: 'workspace-1' },
      false
    )
    await vi.runAllTimersAsync()
    const result = await pending

    const openRouterInputs = fetchMock.mock.calls
      .filter(([url]) => url === 'https://openrouter.ai/api/v1/embeddings')
      .flatMap(([, init]) => JSON.parse((init as RequestInit).body as string).input as string[])
    expect(openRouterInputs).toEqual([secondInput])
    // The succeeding batch, every attempt on the failing one, then its fallback.
    expect(fetchMock).toHaveBeenCalledTimes(1 + (EMBEDDING_MAX_RETRIES + 1) + 1)
    expect(result.embeddings.map(([value]) => value)).toEqual([1, 2])
    expect(result.totalTokens).toBe(6)
    expect(result.billableTokens).toBe(3)
    expect(result.isBYOK).toBe(false)
  })

  /**
   * The retry loop replaces its own backoff with a provider-stated wait, but only
   * if the wait reaches it. Nothing downstream of the transport could see the
   * response headers, so a rate-limited embedding request retried blind.
   */
  it('carries the provider-stated retry wait onto the thrown error', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: '429',
      headers: new Headers({ 'retry-after': '42' }),
      json: async () => ({ error: 'rate limited' }),
      text: async () => 'rate limited',
    } as Response)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' }).catch((e) => e)
    await vi.runAllTimersAsync()
    const error = await pending

    expect(error).toBeInstanceOf(EmbeddingAPIError)
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(42_000)
  })

  /**
   * A stated wait past the ceiling cannot be honoured, so retrying only clamps
   * every attempt below the reopen time and spends the budget for nothing. The
   * error still classifies as transient, so the fallback chain takes over at
   * once rather than after the retries burn down.
   */
  it('does not retry a wait it cannot honour, falling back immediately', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === 'https://api.openai.com/v1/embeddings'
        ? ({
            ok: false,
            status: 429,
            statusText: '429',
            // Six minutes, far past EMBEDDING_MAX_RETRY_DELAY_MS.
            headers: new Headers({
              'x-ratelimit-remaining-tokens': '0',
              'x-ratelimit-reset-tokens': '6m0s',
            }),
            json: async () => ({ error: 'rate limited' }),
            text: async () => 'rate limited',
          } as Response)
        : jsonResponse(openAIBody([[9, 9]], 2))
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = embedKnowledgeForDeployment(['hello'], options, false)
    await vi.runAllTimersAsync()
    const result = await pending

    const openAICalls = fetchMock.mock.calls.filter(([url]) => url.includes('api.openai.com'))
    expect(openAICalls).toHaveLength(1)
    expect(result.embeddings[0].slice(0, 2)).toEqual([9, 9])
  })

  /**
   * A window shorter than the whole budget is still reachable: the individual
   * waits are clamped below it but they accumulate, so a later attempt lands
   * after it reopens. Refusing these would strand a single-provider caller that
   * had only to wait a little longer than one clamped delay.
   */
  it('keeps retrying a wait the budget can outlast, and recovers', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    let call = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          statusText: '429',
          // Above the per-attempt ceiling, well inside the total budget.
          headers: new Headers({ 'retry-after': '35' }),
          json: async () => ({ error: 'rate limited' }),
          text: async () => 'rate limited',
        } as Response
      }
      return jsonResponse(openAIBody([[4, 4]], 2))
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings[0].slice(0, 2)).toEqual([4, 4])
  })

  /**
   * A spent account never reopens, and the sweep re-queues failed documents every
   * sync — so retrying one burns the budget per document, indefinitely.
   */
  it('does not retry a 429 that reports an exhausted balance', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: 'You have no credits remaining.',
            type: 'insufficient_quota',
            code: 'credit_balance_exhausted',
          },
        },
        429
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(embed(['hello'], { ...options, apiKey: 'openai-test' })).rejects.toEqual(
      expect.objectContaining({ name: 'EmbeddingQuotaExhaustedError', quotaExhausted: true })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies quota JSON beyond the diagnostic truncation boundary', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          diagnosticPadding: 'x'.repeat(10_000),
          error: {
            message: 'You have no credits remaining.',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        },
        429
      )
    )

    await expect(embed(['hello'], { ...options, apiKey: 'large-quota-body-key' })).rejects.toEqual(
      expect.objectContaining({
        name: 'EmbeddingQuotaExhaustedError',
        status: 429,
      })
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('short-circuits later requests that use the exhausted credential', async () => {
    const quotaResponse = jsonResponse(
      { error: { type: 'insufficient_quota', code: 'insufficient_quota' } },
      429
    )
    fetchMock.mockResolvedValue(quotaResponse)

    await expect(embed(['first'], { ...options, apiKey: 'exhausted-key' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    await expect(embed(['second'], { ...options, apiKey: 'exhausted-key' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * A rate limit with the same status must keep its retries — the two are only
   * distinguishable by the body.
   */
  it('shares hosted pauses across rotated keys while isolating customer keys', async () => {
    setEnv({ OPENAI_API_KEY: 'hosted-first' })
    fetchMock.mockResolvedValue(jsonResponse({ error: { type: 'insufficient_quota' } }, 429))
    await expect(embed(['first'], { model: 'text-embedding-3-small' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    setEnv({ OPENAI_API_KEY: 'hosted-rotated' })
    await expect(embed(['second'], { model: 'text-embedding-3-small' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 2)))
    await embed(['customer'], { apiKey: 'separate-customer-key' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockCooldown).toHaveBeenCalledWith(
      expect.objectContaining({ credentialFingerprint: 'hosted:openai' }),
      300_000,
      true
    )
  })

  it('still retries a 429 that reports a rate limit', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    let call = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
          json: async () => ({}),
          text: async () =>
            JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_exceeded' } }),
        } as Response
      }
      return jsonResponse(openAIBody([[5, 5]], 2))
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings[0].slice(0, 2)).toEqual([5, 5])
  })

  /**
   * An exhausted key rules out the key just used, not the next one in the chain,
   * so failover must still consider it.
   */
  it('keeps an exhausted-balance error eligible for failover', () => {
    const error = new EmbeddingAPIError('Embedding API failed: 429', 429)
    error.quotaExhausted = true
    expect(isTransientEmbeddingError(error)).toBe(true)
  })

  it('classifies aggregate quota exhaustion only when every fallback exhausted credit', () => {
    const openAIQuota = new EmbeddingQuotaExhaustedError('openai')
    const openRouterQuota = new EmbeddingQuotaExhaustedError('openrouter')

    expect(isEmbeddingQuotaExhaustion(new AggregateError([openAIQuota, openRouterQuota]))).toBe(
      true
    )
    expect(
      isEmbeddingQuotaExhaustion(
        new AggregateError([openAIQuota, new EmbeddingAPIError('temporarily unavailable', 503)])
      )
    ).toBe(false)
  })

  it('classifies only transient embedding failures for failover', () => {
    expect(isTransientEmbeddingError(new EmbeddingAPIError('unavailable', 503))).toBe(true)
    expect(isTransientEmbeddingError(new EmbeddingAPIError('rate limited', 429))).toBe(true)
    expect(isTransientEmbeddingError(new EmbeddingAPIError('invalid key', 401))).toBe(false)
    expect(isTransientEmbeddingError(new DOMException('timed out', 'AbortError'))).toBe(true)
  })

  it('does not misclassify quota-related BYOK rejections as authentication failures', () => {
    const error = new EmbeddingAPIError('Embedding API failed: 403', 403, true)
    error.quotaExhausted = true

    expect(isBYOKEmbeddingCredentialRejection(error)).toBe(false)
  })
})

describe('ollama embeddings', () => {
  function ollamaBody(vectors: number[][], dimensions: number, promptEvalCount = 3) {
    return {
      embeddings: vectors.map((vector) => sizedVector(vector, dimensions)),
      prompt_eval_count: promptEvalCount,
    }
  }

  it('embeds against the configured server with no credential and bills nothing', async () => {
    setEnv({ OLLAMA_URL: 'http://ollama.internal:11434/' })
    fetchMock.mockResolvedValue(jsonResponse(ollamaBody([[1, 2, 3]], 768)))

    const result = await embed(['hello'], {
      model: 'ollama/nomic-embed-text',
      dimensions: 768,
      projectInputs: null,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://ollama.internal:11434/api/embed')
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: 'nomic-embed-text',
      input: ['hello'],
      truncate: true,
    })
    expect(result.dimensions).toBe(768)
    expect(result.modelName).toBe('nomic-embed-text')
    expect(result.isBYOK).toBe(true)
    expect(result.billableTokens).toBe(0)
    expect(result.totalTokens).toBe(3)
  })

  /**
   * The width is the operator's to get right, so the failure has to name both
   * numbers rather than storing a vector the knowledge base cannot query.
   */
  it('rejects a model that returns a different width than the base stores', async () => {
    setEnv({ OLLAMA_URL: 'http://ollama.internal:11434' })
    fetchMock.mockResolvedValue(jsonResponse(ollamaBody([[1, 2, 3]], 1024)))

    await expect(
      embed(['hello'], { model: 'ollama/mxbai-embed-large', dimensions: 768, projectInputs: null })
    ).rejects.toThrow('has 1024 unexpected dimensions; expected 768')
  })

  /**
   * A self-hosted deployment runs alongside its own Ollama, so the loopback
   * default is a working configuration that needs no env var — the same rule
   * the chat provider and the block's model selector apply. Requiring the
   * variable here would make embedding stricter than the list that offers the
   * models.
   */
  it('serves a self-hosted deployment from the loopback default', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ollamaBody([[1, 2, 3]], 768)))

    const result = await embed(['hello'], {
      model: 'ollama/nomic-embed-text',
      dimensions: 768,
      projectInputs: null,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/embed')
    expect(result.dimensions).toBe(768)
  })

  it('ignores a caller-supplied key rather than sending one Ollama cannot use', async () => {
    setEnv({ OLLAMA_URL: 'http://ollama.internal:11434' })
    fetchMock.mockResolvedValue(jsonResponse(ollamaBody([[1, 2, 3]], 384)))

    await embed(['hello'], {
      model: 'ollama/all-minilm',
      dimensions: 384,
      apiKey: 'sk-not-applicable',
      projectInputs: null,
    })

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toEqual({ 'Content-Type': 'application/json' })
  })
})

describe('knowledge embedding capacity preflight', () => {
  const options = { model: 'text-embedding-3-small', dimensions: 1536 }

  it('refuses a paused hosted pool without spending provider admission or making requests', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key', OPENROUTER_API_KEY: 'fallback-key' })
    quotaGates.add('hosted:openai')

    await expect(
      assertKnowledgeEmbeddingCapacityForDeployment(options, true)
    ).rejects.toBeInstanceOf(EmbeddingQuotaExhaustedError)
    expect(mockAdmit).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the workspace credential independently of an exhausted hosted pool', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key' })
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'workspace-key', isBYOK: true })
    quotaGates.add('hosted:openai')

    await expect(
      assertKnowledgeEmbeddingCapacityForDeployment(
        { ...options, workspaceId: 'workspace-1' },
        true
      )
    ).resolves.toBeUndefined()
    expect(mockGetBYOKKey).toHaveBeenCalledWith('workspace-1', 'openai')
    const identity = mockQuotaCheck.mock.calls[0][0]
    expect(identity.credentialFingerprint).not.toBe('hosted:openai')
    quotaGates.add(identity.credentialFingerprint)
    await expect(
      assertKnowledgeEmbeddingCapacityForDeployment(
        { ...options, workspaceId: 'workspace-1' },
        true
      )
    ).rejects.toBeInstanceOf(EmbeddingQuotaExhaustedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps an available self-hosted fallback eligible when primary quota is exhausted', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key', OPENROUTER_API_KEY: 'fallback-key' })
    quotaGates.add('hosted:openai')

    await expect(
      assertKnowledgeEmbeddingCapacityForDeployment(options, false)
    ).resolves.toBeUndefined()
    expect(mockQuotaCheck.mock.calls.map(([identity]) => identity.providerId)).toEqual([
      'openai',
      'openrouter',
    ])
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))
    await embedKnowledgeForDeployment(['text'], options, false)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/embeddings')
  })

  it('defers only when every configured fallback is exhausted', async () => {
    setEnv({
      AZURE_OPENAI_API_KEY: 'azure-key',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_VERSION: '2024-10-21',
      OPENAI_API_KEY: 'platform-key',
      OPENROUTER_API_KEY: 'fallback-key',
    })
    for (const provider of ['azure-openai', 'openai', 'openrouter'])
      quotaGates.add(`hosted:${provider}`)
    const error = await assertKnowledgeEmbeddingCapacityForDeployment(options, false).catch(
      (error) => error
    )
    expect(error).toBeInstanceOf(AggregateError)
    expect(isEmbeddingQuotaExhaustion(error)).toBe(true)
    expect(mockQuotaCheck.mock.calls.map(([identity]) => identity.providerId)).toEqual([
      'azure-openai',
      'openai',
      'openrouter',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates admission storage failure instead of treating an alternate as available', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key', OPENROUTER_API_KEY: 'fallback-key' })
    const failure = new Error('Quota storage unavailable')
    mockQuotaCheck.mockRejectedValueOnce(failure)
    await expect(assertKnowledgeEmbeddingCapacityForDeployment(options, false)).rejects.toBe(
      failure
    )
    expect(mockQuotaCheck).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honors cancellation before and during a quota read', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key' })
    const controller = new AbortController()
    controller.abort()
    await expect(
      assertKnowledgeEmbeddingCapacityForDeployment({ ...options, signal: controller.signal }, true)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockQuotaCheck).not.toHaveBeenCalled()

    const duringRead = new AbortController()
    mockQuotaCheck.mockImplementationOnce(async () => {
      duringRead.abort()
      return false
    })
    await expect(
      assertKnowledgeEmbeddingCapacityForDeployment({ ...options, signal: duringRead.signal }, true)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
