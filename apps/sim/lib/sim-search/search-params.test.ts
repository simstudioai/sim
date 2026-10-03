import { describe, expect, it } from 'vitest'
import { searchSetupParam, searchSetupReturnParam } from '@/lib/sim-search/search-params'

describe('Search setup navigation', () => {
  it('rejects arbitrary redirects and keeps the empty picker value', () => {
    expect(searchSetupParam.parser.parse('')).toBe('')
    expect(searchSetupParam.parser.parse('https://example.com')).toBeNull()
    expect(searchSetupReturnParam.parser.parse('https://example.com')).toBeNull()
  })
})
