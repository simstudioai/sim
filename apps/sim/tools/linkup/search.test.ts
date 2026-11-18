import { describe, expect, it } from 'vitest'
import { searchTool } from '@/tools/linkup/search'

function body(maxResults: unknown) {
  return searchTool.request.body?.({
    q: 'q',
    apiKey: 'k',
    depth: 'standard',
    outputType: 'searchResults',
    maxResults,
  } as never) as Record<string, unknown>
}

describe('linkup_search maxResults', () => {
  it('omits Max Results when the field was never filled in (null) or left blank', () => {
    expect(body(null)).not.toHaveProperty('maxResults')
    expect(body('')).not.toHaveProperty('maxResults')
    expect(body(undefined)).not.toHaveProperty('maxResults')
  })

  it('sends a whole number and rejects zero', () => {
    expect(body('5').maxResults).toBe(5)
    expect(() => body('0')).toThrow(/at least 1/)
  })
})
