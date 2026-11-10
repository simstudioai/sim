import { describe, expect, it } from 'vitest'
import { searchSetupParam } from '@/lib/sim-search/params'

describe('Search setup navigation', () => {
  it('rejects arbitrary redirects and keeps the empty picker value', () => {
    expect(searchSetupParam.parser.parse('')).toBe('')
    expect(searchSetupParam.parser.parse('https://example.com')).toBeNull()
  })
})
