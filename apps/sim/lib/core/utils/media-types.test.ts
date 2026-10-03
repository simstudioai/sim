import { describe, expect, it } from 'vitest'
import { acceptsMediaType } from '@/lib/core/utils/media-types'

describe('acceptsMediaType', () => {
  it.each([
    ['application/json, application/x-ndjson', true],
    ['application/x-ndjson; q=0.5', true],
    ['Application/X-Ndjson;Q=1.000', true],
    ['application/json, application/x-ndjson;q=0', false],
    ['application/x-ndjson;q=0.000', false],
    ['application/x-ndjson;q=1.1', false],
    ['application/x-ndjson;q=invalid', false],
    ['application/x-ndjson;q=1;q=0', false],
    ['application/x-ndjson;profile="one,two";q=0', false],
    ['application/x-ndjson;profile="one;two";q=0.5', true],
    ['application/x-ndjson;profile="unterminated;q=0', false],
    ['application/json', false],
    ['*/*', false],
    ['', false],
  ])('parses %s', (header, expected) => {
    expect(acceptsMediaType(header, 'application/x-ndjson')).toBe(expected)
  })

  it('rejects a missing Accept header', () => {
    expect(acceptsMediaType(null, 'application/x-ndjson')).toBe(false)
  })
})
