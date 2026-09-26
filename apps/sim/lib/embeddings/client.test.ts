import { resetEnvMock, setEnv } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { apiKeyByokMock, apiKeyByokMockFns } from '@sim/testing/mocks/api-key-byok.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import {
  assertKnowledgeEmbeddingCapacityForDeployment,
  EMBEDDING_MAX_RETRIES,
  EmbeddingQuotaExhaustedError,
  embed,
  embedKnowledgeForDeployment,
  embedOpenRouter,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
  MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
} from '@/lib/embeddings/client'

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

vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)

const mockGetBYOKKey = apiKeyByokMockFns.mockGetBYOKKey

/**
 * Exercises the orchestrator end-to-end against a mocked transport: batching,
 * per-provider item caps, input ordering, dimension resolution, and retry.
 * Every call passes an explicit `apiKey` so BYOK/env/rotating-pool resolution
 * (which needs a database) is bypassed.
 */

const originalFetch = global.fetch

function sizedVector(values: number[], dimensions: number): number[] {
  return [...values, ...Array(Math.max(0, dimensions - values.length)).fill(0)].slice(0, dimensions)
}

function openAICompatibleBody(
  vectors: number[][],
  totalTokens = 5,
  dimensions: number | null = 1536
) {
  return {
    data: vectors.map((embedding) => ({
      embedding: dimensions === null ? embedding : sizedVector(embedding, dimensions),
    })),
    usage: { total_tokens: totalTokens },
  }
}

function openAIBody(vectors: number[][], totalTokens = 5, dimensions: number | null = 1536) {
  const body = openAICompatibleBody(vectors, totalTokens, dimensions)
  return {
    ...body,
    data: body.data.map(({ embedding }) => {
      const bytes = Buffer.alloc(embedding.length * 4)
      embedding.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
      return { embedding: bytes.toString('base64') }
    }),
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
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'ProviderCapacityDeferredError',
      reason: 'provider_timeout',
      cause: { name: 'TimeoutError' },
    })
    await vi.advanceTimersByTimeAsync(150_000)
    await rejected
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('rejects an unsupported dimension before making a request', async () => {
    await expect(
      embed(['hello'], { model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 999 })
    ).rejects.toThrow(/does not support 999/)
    expect(fetchMock).not.toHaveBeenCalled()
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
      message: 'the vector payload could not be parsed',
    },
    {
      name: 'a vector with the wrong catalog dimension',
      inputs: ['alpha'],
      body: openAIBody([[1, 2]], 1, null),
      message: 'the vector payload could not be parsed',
    },
    {
      name: 'a numeric array instead of base64',
      inputs: ['alpha'],
      body: openAICompatibleBody([[1]], 1),
      message: 'the vector payload could not be parsed',
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
  })
})

describe('embedOpenRouter', () => {
  it('fails when OpenRouter returns the wrong number of vectors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAICompatibleBody([[1, 2]], 5, null)))

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

  it('rejects a dynamic-model batch that differs from the learned dimension', async () => {
    const inputs = Array.from({ length: 2049 }, (_, index) => `i${index}`)
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const batch = body.input as string[]
      const embedding = batch.length === 1 ? [2, 3, 4] : [1, 3]
      return jsonResponse(
        openAICompatibleBody(
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

  it('rejects an oversized dynamic aggregate after discovery and before fan-out', async () => {
    const dimensions = 32_768
    fetchMock.mockResolvedValue(
      jsonResponse(openAICompatibleBody([sizedVector([1], dimensions)], 1, null))
    )

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
})

describe('knowledge embedding transport fallback', () => {
  const options = {
    model: 'text-embedding-3-small',
    taskType: 'document' as const,
    dimensions: 1536,
    projectInputs: null,
  }

  it('uses Azure before OpenAI and OpenRouter when all are configured', async () => {
    setEnv({
      AZURE_OPENAI_API_KEY: 'azure-test',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_VERSION: '2024-10-21',
      KB_OPENAI_MODEL_NAME: 'kb-embedding-deployment',
      OPENAI_API_KEY: 'openai-test',
      OPENROUTER_API_KEY: 'or-test',
    })
    fetchMock.mockResolvedValue(jsonResponse(openAICompatibleBody([[1, 2]])))

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

  it('falls back immediately when the first provider credential has exhausted credit', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockImplementation(async (url) =>
      url === 'https://api.openai.com/v1/embeddings'
        ? jsonResponse({ error: { type: 'insufficient_quota', code: 'insufficient_quota' } }, 429)
        : jsonResponse(openAICompatibleBody([[7, 8]], 2))
    )

    const result = await embedKnowledgeForDeployment(['hello'], options, false)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.com/v1/embeddings',
      'https://openrouter.ai/api/v1/embeddings',
    ])
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
      return jsonResponse(
        url === 'https://api.openai.com/v1/embeddings'
          ? openAIBody([[1]], 3)
          : openAICompatibleBody([[2]], 3)
      )
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
        : jsonResponse(openAICompatibleBody([[9, 9]], 2))
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
})

describe('durable embedding batches', () => {
  function memoryCheckpoints() {
    const stored = new Map<string, import('@/lib/embeddings/types').EmbeddingBatchResult>()
    return {
      stored,
      load: vi.fn(
        async (identity: import('@/lib/embeddings/types').EmbeddingBatchIdentity) =>
          stored.get(identity.key) ?? null
      ),
      save: vi.fn(
        async (
          identity: import('@/lib/embeddings/types').EmbeddingBatchIdentity,
          result: import('@/lib/embeddings/types').EmbeddingBatchResult
        ) => {
          stored.set(identity.key, result)
        }
      ),
      beforeRequest: vi.fn(),
    }
  }

  it('retains every admitted batch failure so durable recovery can honor the longest wait', async () => {
    const checkpoints = memoryCheckpoints()
    const shortWait = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 60_000 })
    const longWait = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 600_000 })
    checkpoints.beforeRequest
      .mockImplementationOnce(() => {
        throw shortWait
      })
      .mockImplementation(() => {
        throw longWait
      })
    await expect(
      embed(
        Array.from({ length: 24 }, (_, index) => `part ${index} ${'token '.repeat(5000)}`),
        { apiKey: 'fixture-key', checkpoints }
      )
    ).rejects.toMatchObject({
      name: 'AggregateError',
      errors: expect.arrayContaining([shortWait, longWait]),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drains admitted batches, resumes only missing requests and retains the complete token charge', async () => {
    const checkpoints = memoryCheckpoints()
    const texts = Array.from({ length: 24 }, (_, i) => `section ${i} ${'token '.repeat(5000)}`)
    const successful = new Set<string>()
    let failOnce = true
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const inputs = (JSON.parse(String(init.body)) as { input: string[] }).input
      if (failOnce && inputs[0].startsWith('section 1 ')) {
        failOnce = false
        return jsonResponse({ error: { message: 'Synthetic rejection' } }, 400)
      }
      for (const input of inputs) {
        expect(successful.has(input)).toBe(false)
        successful.add(input)
      }
      return jsonResponse(
        openAIBody(
          inputs.map(() => [1]),
          inputs.length * 5000
        )
      )
    })
    const options = {
      apiKey: 'fixture-key',
      model: 'text-embedding-3-small',
      projectInputs: null,
      checkpoints,
    } as const
    await expect(embed(texts, options)).rejects.toThrow('Embedding API failed: 400')
    expect(successful.size).toBeGreaterThan(0)
    expect(successful.size).toBeLessThan(texts.length)
    expect(checkpoints.stored.size).toBe(successful.size)
    const afterFailure = fetchMock.mock.calls.length
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(afterFailure)
    const result = await embed(texts, options)
    expect(result.embeddings).toHaveLength(texts.length)
    expect(result.totalTokens).toBe(120000)
    expect(successful.size).toBe(texts.length)
    expect(fetchMock).toHaveBeenCalledTimes(texts.length + 1)
  })

  it('reuses only requests with the current projected inputs, credential, task and dimensions', async () => {
    const checkpoints = memoryCheckpoints()
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[]; dimensions?: number }
      return jsonResponse(
        openAIBody(
          body.input.map(() => [1]),
          7,
          body.dimensions ?? 1536
        )
      )
    })
    const base = {
      apiKey: 'fixture-key',
      model: 'text-embedding-3-small',
      projectInputs: () => ['projected-one'],
      checkpoints,
    } as const
    await embed(['private input'], base)
    checkpoints.beforeRequest.mockImplementation(() => {
      throw new Error('new request refused')
    })
    expect((await embed(['private input'], base)).totalTokens).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(embed(['private input'], { ...base, apiKey: 'replacement-key' })).rejects.toThrow(
      'new request refused'
    )
    await expect(
      embed(['private input'], { ...base, projectInputs: () => ['projected-two'] })
    ).rejects.toThrow('new request refused')
    await expect(embed(['private input'], { ...base, dimensions: 512 })).rejects.toThrow(
      'new request refused'
    )
    await expect(embed(['private input'], { ...base, taskType: 'query' })).rejects.toThrow(
      'new request refused'
    )
    expect(JSON.stringify([...checkpoints.stored.keys()])).not.toContain('private input')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects projected indexing inputs that would otherwise be silently shortened', async () => {
    const checkpoints = memoryCheckpoints()
    await expect(
      embed(['short input'], {
        apiKey: 'fixture-key',
        model: 'text-embedding-3-small',
        projectInputs: () => ['token '.repeat(20000)],
        checkpoints,
        inputOverflow: 'reject',
      })
    ).rejects.toThrow('projected embedding input exceeds')
    expect(checkpoints.load).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
