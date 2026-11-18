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

  it("drops Read URL's stored format and image values on Search", () => {
    const raw = { operation: 'jina_search', returnFormat: 'screenshot', retainImages: 'none' }
    const merged = { ...raw, ...JinaBlock.tools.config?.params?.(raw) }

    expect(merged.returnFormat).toBeUndefined()
    expect(merged.retainImages).toBeUndefined()
  })
})
