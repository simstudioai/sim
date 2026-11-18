import { describe, expect, it } from 'vitest'
import { JinaBlock } from '@/blocks/blocks/jina'
import { searchTool } from '@/tools/jina/search'

describe('jina_search request', () => {
  it('sends the no-content mode for the "No Content" checkbox instead of a boolean', () => {
    const headers = searchTool.request.headers({ q: 'q', apiKey: 'k', respondWith: true })

    expect(headers['X-Respond-With']).toBe('no-content')
  })

  it('applies the search-specific Return Format and Retain Images fields', () => {
    const mapped = JinaBlock.tools.config?.params?.({
      operation: 'jina_search',
      searchReturnFormat: 'html',
      searchRetainImages: 'none',
    })

    expect(mapped).toEqual({ returnFormat: 'html', retainImages: 'none' })
  })
})
