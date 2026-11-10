import { jsonResponse } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/firecrawl/search'

describe('Firecrawl v2 search results', () => {
  it('preserves the workflow result array when the provider groups results by source', async () => {
    if (!searchTool.transformResponse) throw new Error('Missing response transform')
    const result = await searchTool.transformResponse(
      jsonResponse({
        success: true,
        data: {
          web: [{ url: 'https://example.com', title: 'Example', description: 'A web result' }],
        },
        creditsUsed: 2,
      })
    )

    expect(result.output.data).toEqual([
      { url: 'https://example.com', title: 'Example', description: 'A web result' },
    ])
    expect(result.output.creditsUsed).toBe(2)
  })

  it('returns an empty result array when the provider finds no web results', async () => {
    if (!searchTool.transformResponse) throw new Error('Missing response transform')
    const result = await searchTool.transformResponse(
      jsonResponse({ success: true, data: {}, creditsUsed: 0 })
    )

    expect(result.output.data).toEqual([])
  })
})
