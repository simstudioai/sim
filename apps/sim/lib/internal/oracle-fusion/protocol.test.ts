/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const COLLECTION = '/hcmRestApi/resources/11.13.18.05/workers'

function resource(href: unknown, links: unknown[] = []): Record<string, unknown> {
  return { links: [{ rel: 'self', href }, ...links] }
}

describe('parseOracleFusionCollection', () => {
  it('projects a valid page and calculates the next offset', () => {
    expect(
      parseOracleFusionCollection(
        {
          items: [{ id: 1 }, { id: 2 }],
          count: 2,
          hasMore: true,
          limit: 25,
          offset: 50,
          totalResults: 80,
        },
        (item, index) => ({ ...(item as object), index })
      )
    ).toEqual({
      items: [
        { id: 1, index: 0 },
        { id: 2, index: 1 },
      ],
      count: 2,
      hasMore: true,
      limit: 25,
      offset: 50,
      totalResults: 80,
      nextOffset: 52,
    })
  })

  it('accepts an empty terminal page without inventing nextOffset', () => {
    expect(
      parseOracleFusionCollection(
        { items: [], count: 0, hasMore: false, limit: 25, offset: 0 },
        (item) => item
      )
    ).toEqual({ items: [], count: 0, hasMore: false, limit: 25, offset: 0 })
  })

  it.each([
    [null, 'must be an object'],
    [{}, 'items must be an array'],
    [{ items: [], count: -1, hasMore: false, limit: 25, offset: 0 }, 'count'],
    [{ items: [], count: 0, hasMore: 'no', limit: 25, offset: 0 }, 'hasMore'],
    [{ items: [{}], count: 0, hasMore: false, limit: 25, offset: 0 }, 'match'],
    [{ items: [], count: 0, hasMore: true, limit: 25, offset: 0 }, 'empty page'],
    [{ items: [], count: 0, hasMore: false, limit: 0, offset: 0 }, 'positive'],
    [{ items: [{}], count: 1, hasMore: false, limit: 25, offset: 4, totalResults: 4 }, 'smaller'],
    [
      { items: [{}], count: 1, hasMore: true, limit: 25, offset: Number.MAX_SAFE_INTEGER },
      'safe integer range',
    ],
  ])('rejects malformed collection envelope %#', (value, message) => {
    expect(() => parseOracleFusionCollection(value, (item) => item)).toThrow(message as string)
  })
})

describe('Oracle self links', () => {
  it('accepts exactly one same-origin self link for the expected path', () => {
    expect(() =>
      validateOracleFusionSelfLink(
        resource(`${ORIGIN}${COLLECTION}/abc`),
        ORIGIN,
        `${COLLECTION}/abc`
      )
    ).not.toThrow()
  })

  it.each([
    [{}, 'exactly one'],
    [{ links: [] }, 'exactly one'],
    [
      resource(`${ORIGIN}${COLLECTION}/abc`, [{ rel: 'self', href: `${ORIGIN}/duplicate` }]),
      'exactly one',
    ],
    [resource(123), 'malformed'],
    [resource('not a URL'), 'malformed'],
    [resource(`https://evil.example${COLLECTION}/abc`), 'credential-bound origin'],
    [resource(`${ORIGIN}${COLLECTION}/abc?secret=value`), 'credential-bound origin'],
    [resource(`${ORIGIN}${COLLECTION}/other`), 'requested resource path'],
  ])('rejects missing, duplicate, malformed, or unbound self links %#', (value, message) => {
    expect(() => validateOracleFusionSelfLink(value, ORIGIN, `${COLLECTION}/abc`)).toThrow(
      message as string
    )
  })

  it('extracts and URL-encodes an opaque key without changing its value', () => {
    const key = 'person:123,assignment=456'
    const encoded = encodeOracleFusionPathSegment(key)
    expect(encoded).toBe('person%3A123%2Cassignment%3D456')
    expect(
      extractOracleFusionOpaqueKey(
        resource(`${ORIGIN}${COLLECTION}/${encoded}`),
        ORIGIN,
        COLLECTION
      )
    ).toBe(key)
  })

  it.each(['', '.', '..', 'a/b', 'a\\b', 'a?b', 'a#b', 'a\nb', 'x'.repeat(2049)])(
    'rejects the unsafe opaque key %j',
    (key) => {
      expect(() => encodeOracleFusionPathSegment(key)).toThrow('safe opaque path segment')
    }
  )

  it.each([
    [`${ORIGIN}/other/abc`, 'collection path'],
    [`${ORIGIN}${COLLECTION}/a/b`, 'one opaque key'],
    [`${ORIGIN}${COLLECTION}/a%2Fb`, 'one opaque key'],
    [`${ORIGIN}${COLLECTION}/a%5Cb`, 'one opaque key'],
    [`${ORIGIN}${COLLECTION}/%E0%A4%A`, 'invalid URL encoding'],
  ])('rejects an unsafe opaque-key self link %j', (href, message) => {
    expect(() => extractOracleFusionOpaqueKey(resource(href), ORIGIN, COLLECTION)).toThrow(message)
  })
})
