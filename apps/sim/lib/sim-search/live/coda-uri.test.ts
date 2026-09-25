import { describe, expect, it } from 'vitest'
import { parseCodaResourceUri } from '@/lib/sim-search/live/coda-uri'

describe('Coda MCP resource URIs', () => {
  it('accepts legacy and current document resources while dropping display fragments', () => {
    expect(parseCodaResourceUri('coda://docs/old/pages/page')).toEqual({
      uri: 'coda://docs/old/pages/page',
      docId: 'old',
    })
    expect(
      parseCodaResourceUri('superhuman://docs/current/pages/section-page#Readable%20title')
    ).toEqual({ uri: 'superhuman://docs/current/pages/section-page', docId: 'current' })
  })

  it.each([
    'https://docs.superhuman.com/d/doc',
    'superhuman://other/doc',
    'superhuman://docs/doc/../other',
    'superhuman://docs/doc/pages/page?unexpected=1',
    'superhuman://docs/doc//page',
    `superhuman://docs/${'a'.repeat(1001)}`,
  ])('rejects an unsupported resource URI: %s', (uri) => {
    expect(parseCodaResourceUri(uri)).toBeNull()
  })
})
