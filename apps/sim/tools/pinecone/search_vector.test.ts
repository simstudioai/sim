import { describe, expect, it } from 'vitest'
import { searchVectorTool } from '@/tools/pinecone/search_vector'

describe('searchVectorTool', () => {
  const buildBody = searchVectorTool.request.body!
  const baseParams = {
    indexHost: 'https://example.pinecone.io',
    namespace: 'default',
    vector: [0.1, 0.2],
    apiKey: 'test-key',
  }

  it.each([
    {
      name: 'neither option',
      options: [],
      expected: { includeValues: false, includeMetadata: false },
    },
    {
      name: 'include values only',
      options: ['includeValues'],
      expected: { includeValues: true, includeMetadata: false },
    },
    {
      name: 'include metadata only',
      options: ['includeMetadata'],
      expected: { includeValues: false, includeMetadata: true },
    },
    {
      name: 'both options',
      options: ['includeValues', 'includeMetadata'],
      expected: { includeValues: true, includeMetadata: true },
    },
  ])('maps $name to the Pinecone query flags', ({ options, expected }) => {
    const body = buildBody({ ...baseParams, ...options })

    expect(body).toMatchObject(expected)
  })
})
