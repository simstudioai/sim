/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchVectorTool } from '@/tools/pinecone/search_vector'

const baseParams = {
  apiKey: 'test-key',
  indexHost: 'https://example.pinecone.io',
  vector: [0.1, 0.2],
}

describe('Pinecone vector search output options', () => {
  it.each([
    [{}, false, false],
    [{ includeValues: true }, true, false],
    [{ includeMetadata: true }, false, true],
    [{ includeValues: true, includeMetadata: true }, true, true],
  ])('sends the selected options (%j)', (options, includeValues, includeMetadata) => {
    const body = searchVectorTool.request.body?.({ ...baseParams, ...options })

    expect(body).toMatchObject({ includeValues, includeMetadata })
  })
})
