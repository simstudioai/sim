import { jsonResponse } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { mapTool } from '@/tools/firecrawl/map'

describe('Firecrawl v2 map results', () => {
  it('preserves URL strings for workflows when the provider returns link objects', async () => {
    if (!mapTool.transformResponse) throw new Error('Missing response transform')
    const result = await mapTool.transformResponse(
      jsonResponse({
        success: true,
        links: [
          { url: 'https://example.com', title: 'Home', description: 'Home page' },
          { url: 'https://example.com/docs', title: 'Docs' },
        ],
      })
    )

    expect(result.output.links).toEqual(['https://example.com', 'https://example.com/docs'])
  })
})
