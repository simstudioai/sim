/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { l2Normalize } from '@/lib/embeddings/normalize'
import {
  createCohereAdapter,
  createGeminiAdapter,
  createMistralAdapter,
  createOpenAIAdapter,
  createOpenRouterAdapter,
} from '@/lib/embeddings/providers'

const INPUTS = ['alpha', 'beta']

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
}

describe('l2Normalize', () => {
  it('scales a vector to unit length', () => {
    expect(norm(l2Normalize([3, 4]))).toBeCloseTo(1)
  })

  it('leaves a zero vector alone rather than dividing by zero', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('OpenAI adapter', () => {
  const adapter = createOpenAIAdapter({
    modelName: 'text-embedding-3-small',
    apiKey: 'sk-test',
    nativeDimensions: 1536,
  })

  it('omits dimensions when none is requested, so the model returns its native size', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(request.apiUrl).toBe('https://api.openai.com/v1/embeddings')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    expect(request.body).not.toHaveProperty('dimensions')
  })

  it('sends dimensions when a reduction is requested', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 512 })
    expect(request.body).toMatchObject({ dimensions: 512, model: 'text-embedding-3-small' })
  })

  it('parses vectors and token usage', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    const json = {
      data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
      usage: { total_tokens: 7 },
    }
    expect(request.parse(json)).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(request.parseTokens?.(json)).toBe(7)
  })
})

describe('OpenRouter adapter', () => {
  const adapter = createOpenRouterAdapter({
    modelName: 'text-embedding-3-small',
    apiKey: 'or-test',
    nativeDimensions: 1536,
  })

  it('uses the OpenRouter endpoint and provider-qualified OpenAI model id', () => {
    const request = adapter.buildRequest({
      inputs: INPUTS,
      taskType: 'document',
      dimensions: 1536,
    })

    expect(request.apiUrl).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(request.headers.Authorization).toBe('Bearer or-test')
    expect(request.body).toMatchObject({
      input: INPUTS,
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
      encoding_format: 'float',
    })
  })

  it('parses OpenAI-compatible vectors and usage', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'query' })
    const response = {
      data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
      usage: { total_tokens: 9 },
    }

    expect(request.parse(response)).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(request.parseTokens?.(response)).toBe(9)
  })

  it('passes a dynamic OpenRouter model id through without rewriting its provider', () => {
    const dynamicAdapter = createOpenRouterAdapter({
      modelName: 'openrouter/qwen/qwen3-embedding-8b',
      apiKey: 'or-test',
      nativeDimensions: 0,
    })
    const request = dynamicAdapter.buildRequest({ inputs: INPUTS, taskType: 'document' })

    expect(request.body).toMatchObject({ model: 'qwen/qwen3-embedding-8b' })
  })
})

describe('Gemini adapter', () => {
  const adapter = createGeminiAdapter({
    modelName: 'gemini-embedding-001',
    apiKey: 'g-test',
    nativeDimensions: 3072,
  })

  it('caps items per request at Gemini’s documented limit', () => {
    expect(adapter.maxItemsPerRequest).toBe(100)
  })

  it('maps task types onto Gemini’s enum', () => {
    const asDocument = adapter.buildRequest({ inputs: ['x'], taskType: 'document' })
    const asQuery = adapter.buildRequest({ inputs: ['x'], taskType: 'query' })
    expect(asDocument.body).toMatchObject({
      requests: [expect.objectContaining({ taskType: 'RETRIEVAL_DOCUMENT' })],
    })
    expect(asQuery.body).toMatchObject({
      requests: [expect.objectContaining({ taskType: 'RETRIEVAL_QUERY' })],
    })
  })

  it('normalizes only when the output is reduced below native', () => {
    const raw = { embeddings: [{ values: [3, 4] }] }

    // Reduced: Gemini does not normalize for us, so the adapter must.
    const reduced = adapter.buildRequest({ inputs: ['x'], taskType: 'document', dimensions: 768 })
    expect(norm(reduced.parse(raw)[0])).toBeCloseTo(1)

    // Native: Gemini already returns unit vectors, so values pass through untouched.
    const native = adapter.buildRequest({ inputs: ['x'], taskType: 'document', dimensions: 3072 })
    expect(native.parse(raw)[0]).toEqual([3, 4])
  })
})

describe('Cohere adapter', () => {
  const adapter = createCohereAdapter({
    modelName: 'embed-v4.0',
    apiKey: 'co-test',
    nativeDimensions: 1536,
  })

  it('caps items per request at Cohere’s documented limit', () => {
    expect(adapter.maxItemsPerRequest).toBe(96)
  })

  it('always sends input_type, which the v2 API requires', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'query' })
    expect(request.apiUrl).toBe('https://api.cohere.com/v2/embed')
    expect(request.body).toMatchObject({
      input_type: 'search_query',
      embedding_types: ['float'],
      texts: INPUTS,
    })
  })

  it('reads vectors out of the float embedding type and tokens from billed_units', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    const json = {
      embeddings: { float: [[1, 2]] },
      meta: { billed_units: { input_tokens: 11 } },
    }
    expect(request.parse(json)).toEqual([[1, 2]])
    expect(request.parseTokens?.(json)).toBe(11)
  })

  it('fails loudly when the requested embedding type is missing', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(() => request.parse({ embeddings: {} })).toThrow(/did not include float embeddings/)
  })

  it('normalizes reduced output, which Cohere never documents as renormalized', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 256 })
    const [vector] = request.parse({ embeddings: { float: [[3, 4]] } })
    expect(norm(vector)).toBeCloseTo(1)
  })

  it('leaves full-width output untouched', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 1536 })
    expect(request.parse({ embeddings: { float: [[3, 4]] } })).toEqual([[3, 4]])
  })
})

describe('Mistral adapter', () => {
  const adapter = createMistralAdapter({
    modelName: 'mistral-embed',
    apiKey: 'm-test',
    nativeDimensions: 1024,
  })

  it('uses the singular `input` field the REST API documents', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(request.apiUrl).toBe('https://api.mistral.ai/v1/embeddings')
    expect(request.body).toMatchObject({ input: INPUTS, model: 'mistral-embed' })
    expect(request.body).not.toHaveProperty('inputs')
  })

  it('restores input order from the response index', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    const json = {
      data: [
        { embedding: [9, 9], index: 1 },
        { embedding: [1, 1], index: 0 },
      ],
      usage: { total_tokens: 4 },
    }
    expect(request.parse(json)).toEqual([
      [1, 1],
      [9, 9],
    ])
    expect(request.parseTokens?.(json)).toBe(4)
  })
})
