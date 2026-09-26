import { describe, expect, it } from 'vitest'
import { parseCodaResourceUri } from '@/lib/sim-search/live/coda-uri'

describe('Coda MCP resource URIs', () => {
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
