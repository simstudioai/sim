/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embed } from '@/lib/embeddings/client'

/**
 * Exercises the orchestrator end-to-end against a mocked transport: batching,
 * per-provider item caps, input ordering, dimension resolution, and retry.
 * Every call passes an explicit `apiKey` so BYOK/env/rotating-pool resolution
 * (which needs a database) is bypassed.
 */

const originalFetch = global.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
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
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
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
  })
})
