import { describe, expect, it } from 'vitest'
import { l2Normalize } from '@/lib/embeddings/normalize'
import {
  createCohereAdapter,
  createGeminiAdapter,
  createMistralAdapter,
  createOllamaAdapter,
} from '@/lib/embeddings/providers'

const INPUTS = ['alpha', 'beta']

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
}

describe('l2Normalize', () => {
  it('leaves a zero vector alone rather than dividing by zero', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('Gemini adapter', () => {
  const adapter = createGeminiAdapter({
    modelName: 'gemini-embedding-001',
    apiKey: 'g-test',
    nativeDimensions: 3072,
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

  it('fails loudly when the requested embedding type is missing', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(() => request.parse({ embeddings: {} })).toThrow(/did not include float embeddings/)
  })

  it('normalizes reduced output, which Cohere never documents as renormalized', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 256 })
    const [vector] = request.parse({ embeddings: { float: [[3, 4]] } })
    expect(norm(vector)).toBeCloseTo(1)
  })
})

describe('Mistral adapter', () => {
  const adapter = createMistralAdapter({
    modelName: 'mistral-embed',
    apiKey: 'm-test',
    nativeDimensions: 1024,
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

describe('Ollama adapter', () => {
  const adapter = createOllamaAdapter({
    modelName: 'nomic-embed-text',
    baseUrl: 'http://ollama.internal:11434',
    nativeDimensions: 1536,
  })

  it('never forwards dimensions, which older servers ignore rather than reject', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 768 })
    expect(request.body).not.toHaveProperty('dimensions')
  })
})
