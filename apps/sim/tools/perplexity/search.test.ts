import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/perplexity/search'

describe('perplexity_search request', () => {
  it('sends the publication date window under the _filter names the Search API reads', () => {
    const body = searchTool.request.body?.({
      query: 'q',
      apiKey: 'k',
      search_after_date: '01/01/2025',
      search_before_date: '06/30/2025',
    })

    expect(body).toMatchObject({
      search_after_date_filter: '01/01/2025',
      search_before_date_filter: '06/30/2025',
    })
    expect(body).not.toHaveProperty('search_after_date')
    expect(body).not.toHaveProperty('search_before_date')
  })
})
