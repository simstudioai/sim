import { describe, expect, it } from 'vitest'
import { createOpenAIAdapter } from '@/lib/embeddings/providers/openai'

const IDENTITY = {
  modelName: 'text-embedding-3-small',
  apiKey: 'fixture-key',
  nativeDimensions: 1536,
}

describe('OpenAI base64 embeddings', () => {
  it('decodes little-endian Float32 values without changing their bits', () => {
    const bytes = Buffer.from('cdcccc3d00000080010000000000803f', 'hex')
    const request = createOpenAIAdapter(IDENTITY).buildRequest({
      inputs: ['query'],
      taskType: 'query',
      dimensions: 4,
    })
    const [vector] = request.parse({ data: [{ embedding: bytes.toString('base64') }] })

    expect(vector).toEqual([Math.fround(0.1), -0, 2 ** -149, 1])
    const roundTrip = Buffer.alloc(bytes.length)
    vector.forEach((value, index) => roundTrip.writeFloatLE(value, index * 4))
    expect(roundTrip).toEqual(bytes)
    expect(Array.isArray(vector)).toBe(true)
  })

  it.each([
    ['numeric array', [0, 0]],
    ['empty value', ''],
    ['invalid alphabet', '!AAAAAAAAAA='],
    ['whitespace', ' AAAAAAAAAA='],
    ['noncanonical padding bits', 'AAAAAAAAAAB='],
    ['missing padding', 'AAAAAAAAAAA'],
    ['extra padding', 'AAAAAAAAAAA=='],
    ['short byte payload', Buffer.alloc(7).toString('base64')],
    ['trailing byte', Buffer.alloc(9).toString('base64')],
    ['oversized vector', Buffer.alloc(12).toString('base64')],
  ])('rejects %s', (_name, embedding) => {
    const request = createOpenAIAdapter(IDENTITY).buildRequest({
      inputs: ['query'],
      taskType: 'query',
      dimensions: 2,
    })

    expect(() => request.parse({ data: [{ embedding }] })).toThrow('base64 embedding')
  })
})
