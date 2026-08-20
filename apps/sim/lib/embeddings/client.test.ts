/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMBEDDING_MAX_RETRIES,
  EmbeddingAPIError,
  embed,
  embedKnowledgeForDeployment,
  embedOpenRouter,
  isTransientEmbeddingError,
} from '@/lib/embeddings/client'

const { mockGetBYOKKey } = vi.hoisted(() => ({
  mockGetBYOKKey: vi.fn(),
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
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    // A real Response always carries these; the failure path reads them for rate-limit signals.
    headers: new Headers(responseHeaders),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function openAIBody(vectors: number[][], totalTokens = 5) {
  return {
    data: vectors.map((embedding) => ({ embedding })),
    usage: { total_tokens: totalTokens },
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
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
  })
})

afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetEnvMock()
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
    expect(result.embeddings).toEqual([[1, 2, 3]])
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
      const embeddings = Array.from({ length: count }, (_, i) => ({ values: [cursor + i] }))
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
    fetchMock.mockResolvedValue(jsonResponse({ embeddings: [{ values: [1, 2] }] }))

    const result = await embed(['some text to embed'], {
      model: 'gemini-embedding-001',
      apiKey: 'g-test',
    })

    expect(result.totalTokens).toBeGreaterThan(0)
  })

  it("bills Gemini on its reported token count rather than tiktoken's guess", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        embeddings: [{ values: [1, 2] }],
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

  it('keeps a long Cohere input whole rather than cutting it to the batch budget', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return jsonResponse({
        embeddings: { float: body.texts.map(() => [1]) },
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
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

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
        data: [{ embedding: [1, 2], index: 0 }],
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
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad key' }, 401))

    await expect(
      embed(['hello'], { model: 'text-embedding-3-small', apiKey: 'sk-bad' })
    ).rejects.toThrow(/Embedding API failed: 401/)
    // 401 is not retryable, so exactly one attempt is made.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a rate-limited request and succeeds on a later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse(openAIBody([[7, 8]])))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings).toEqual([[7, 8]])
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
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

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
      fetchMock.mockResolvedValue(jsonResponse({ embeddings: [{ values: [1] }] }))
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
        jsonResponse({ embeddings: { float: [[1]] }, meta: { billed_units: { input_tokens: 9 } } })
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
      fetchMock.mockResolvedValue(jsonResponse({ embeddings: [{ values: [1, 2, 3] }] }))

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
      fetchMock.mockResolvedValue(jsonResponse({ embeddings: [{ values: [1] }] }))
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
      const projectInputs = vi.fn((values: readonly string[]) => values.map(() => 'projected'))
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
        .mockResolvedValueOnce(jsonResponse(openAIBody([[1]])))

      await embed(['secret'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs,
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(projectInputs).toHaveBeenCalledTimes(1)
    })
  })
})

describe('embedOpenRouter', () => {
  it('uses a dynamic model and reports the returned native dimensions', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        openAIBody(
          [
            [1, 2, 3],
            [4, 5, 6],
          ],
          7
        )
      )
    )

    const result = await embedOpenRouter(['alpha', 'beta'], {
      model: 'openrouter/qwen/qwen3-embedding-8b',
      apiKey: 'or-test',
      maxInputTokens: 32768,
      projectInputs: null,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      input: ['alpha', 'beta'],
      model: 'qwen/qwen3-embedding-8b',
    })
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
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    await expect(
      embedOpenRouter(['alpha', 'beta'], {
        model: 'openrouter/qwen/qwen3-embedding-8b',
        apiKey: 'or-test',
        maxInputTokens: 32768,
        projectInputs: null,
      })
    ).rejects.toThrow('returned 1 embeddings for 2 inputs')
  })

  it('fails when OpenRouter returns inconsistent vector dimensions', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2], [3]])))

    await expect(
      embedOpenRouter(['alpha', 'beta'], {
        model: 'openrouter/qwen/qwen3-embedding-8b',
        apiKey: 'or-test',
        maxInputTokens: 32768,
        projectInputs: null,
      })
    ).rejects.toThrow('inconsistent dimensions')
  })

  it('truncates inputs to the selected model context length', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

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
          inputs.length
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
      embeddings: [[1, 2]],
      billableTokens: 3,
      isBYOK: false,
      modelName: 'text-embedding-3-small',
      dimensions: 1536,
    })
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

  it('does not use OpenRouter for non-OpenAI knowledge models', async () => {
    setEnv({ GEMINI_API_KEY: 'gemini-test', OPENROUTER_API_KEY: 'or-test' })
    fetchMock.mockResolvedValue(jsonResponse({ embeddings: [{ values: [1, 2] }] }))

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
    expect(result.embeddings).toEqual([[7, 8]])
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
    expect(result.embeddings).toEqual([[1], [2]])
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
    expect(result.embeddings).toEqual([[9, 9]])
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
    expect(result.embeddings).toEqual([[4, 4]])
  })

  /**
   * A spent account never reopens, and the sweep re-queues failed documents every
   * sync — so retrying one burns the budget per document, indefinitely.
   */
  it('does not retry a 429 that reports an exhausted balance', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        ({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
          json: async () => ({}),
          text: async () =>
            JSON.stringify({
              error: {
                message: 'You have no credits remaining.',
                type: 'insufficient_quota',
                code: 'credit_balance_exhausted',
              },
            }),
        }) as Response
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' }).catch((e) => e)
    await vi.runAllTimersAsync()
    const error = await pending

    expect(error).toBeInstanceOf(EmbeddingAPIError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * A rate limit with the same status must keep its retries — the two are only
   * distinguishable by the body.
   */
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
    expect(result.embeddings).toEqual([[5, 5]])
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

  it('classifies only transient embedding failures for failover', () => {
    expect(isTransientEmbeddingError(new EmbeddingAPIError('unavailable', 503))).toBe(true)
    expect(isTransientEmbeddingError(new EmbeddingAPIError('rate limited', 429))).toBe(true)
    expect(isTransientEmbeddingError(new EmbeddingAPIError('invalid key', 401))).toBe(false)
    expect(isTransientEmbeddingError(new DOMException('timed out', 'AbortError'))).toBe(true)
  })
})
