import { describe, expect, it } from 'vitest'
import { searchSetupParam, searchSetupReturnParam } from '@/lib/sim-search/search-params'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

describe('Search setup navigation', () => {
  it('can open and resume every source advertised by the connector registry', () => {
    for (const [type, meta] of Object.entries(CONNECTOR_META_REGISTRY)) {
      if (!meta.search) continue
      expect(searchSetupParam.parser.parse(type), type).toBe(type)
      expect(searchSetupReturnParam.parser.parse(type), type).toBe(type)
    }
  })

  it('rejects arbitrary redirects and keeps the empty picker value', () => {
    expect(searchSetupParam.parser.parse('')).toBe('')
    expect(searchSetupParam.parser.parse('https://example.com')).toBeNull()
    expect(searchSetupReturnParam.parser.parse('https://example.com')).toBeNull()
  })
})
