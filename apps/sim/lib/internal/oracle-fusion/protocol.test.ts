/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const COLLECTION = '/hcmRestApi/resources/11.13.18.05/workers'
const COLLECTION_ADDRESS = { family: 'hcm', relativePath: 'workers' } as const

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

  it('accepts an empty terminal page and returns its current nextOffset', () => {
    expect(
      parseOracleFusionCollection(
        { items: [], count: 0, hasMore: false, limit: 25, offset: 0 },
        (item) => item
      )
    ).toEqual({ items: [], count: 0, hasMore: false, limit: 25, offset: 0, nextOffset: 0 })
  })

  it('accepts omitted items only for an unambiguous empty terminal page', () => {
    expect(
      parseOracleFusionCollection(
        { count: 0, hasMore: false, limit: 25, offset: 10 },
        (item) => item,
        { expectedOffset: 10, maxItems: 25 }
      )
    ).toEqual({
      items: [],
      count: 0,
      hasMore: false,
      limit: 25,
      offset: 10,
      nextOffset: 10,
    })
  })

  it('validates expected offset and item limits before projection', () => {
    const parseItem = vi.fn((item) => item)
    const page = { items: [{ id: 1 }], count: 1, hasMore: false, limit: 5, offset: 4 }
    expect(() =>
      parseOracleFusionCollection(page, parseItem, { expectedOffset: 3, maxItems: 5 })
    ).toThrow('requested offset')
    expect(() =>
      parseOracleFusionCollection(page, parseItem, { expectedOffset: 4, maxItems: 0 })
    ).toThrow('item limit')
    expect(parseItem).not.toHaveBeenCalled()
  })

  it('does not require the returned limit to equal the caller item cap', () => {
    expect(
      parseOracleFusionCollection(
        { items: [{ id: 1 }], count: 1, hasMore: false, limit: 73, offset: 0 },
        (item) => item,
        { expectedOffset: 0, maxItems: 20 }
      )
    ).toMatchObject({ limit: 73, count: 1, nextOffset: 1 })
  })

  it.each([
    [null, 'must be an object'],
    [{}, 'count'],
    [{ count: 1, hasMore: false, limit: 25, offset: 0 }, 'items must be an array'],
    [{ count: 0, hasMore: true, limit: 25, offset: 0 }, 'items must be an array'],
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
      validateOracleFusionSelfLink(resource(`${ORIGIN}${COLLECTION}/abc`), ORIGIN, {
        family: 'hcm',
        relativePath: 'workers/abc',
      })
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
    expect(() =>
      validateOracleFusionSelfLink(value, ORIGIN, {
        family: 'hcm',
        relativePath: 'workers/abc',
      })
    ).toThrow(message as string)
  })

  it('extracts and URL-encodes an opaque key without changing its value', () => {
    const key = 'person:123,assignment=456'
    const encoded = encodeOracleFusionPathSegment(key)
    expect(encoded).toBe('person%3A123%2Cassignment%3D456')
    expect(
      extractOracleFusionOpaqueKey(
        resource(`${ORIGIN}${COLLECTION}/${encoded}`),
        ORIGIN,
        COLLECTION_ADDRESS
      )
    ).toBe(key)
  })

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a?b', 'a#b', 'a\nb', 'x'.repeat(2049)])(
    'rejects the unsafe opaque key %j',
    (key) => {
      expect(() => encodeOracleFusionPathSegment(key)).toThrow('safe opaque path segment')
    }
  )

  it('rejects malformed Unicode without leaking a URI error', () => {
    expect(() => encodeOracleFusionPathSegment('\ud800')).toThrow(
      'Oracle resource key contains malformed Unicode'
    )
  })

  it('rejects a self-link href containing malformed Unicode before URL parsing', () => {
    expect(() =>
      extractOracleFusionOpaqueKey(
        resource(`${ORIGIN}${COLLECTION}/bad\ud800key`),
        ORIGIN,
        COLLECTION_ADDRESS
      )
    ).toThrow('Oracle self link is malformed')
  })

  it.each([
    [`${ORIGIN}/other/abc`, 'collection path'],
    [`${ORIGIN}${COLLECTION}/a/b`, 'one opaque key'],
    [`${ORIGIN}${COLLECTION}/a%2Fb`, 'one opaque key'],
    [`${ORIGIN}${COLLECTION}/a%5Cb`, 'one opaque key'],
    [`${ORIGIN}${COLLECTION}/%E0%A4%A`, 'invalid URL encoding'],
  ])('rejects an unsafe opaque-key self link %j', (href, message) => {
    expect(() => extractOracleFusionOpaqueKey(resource(href), ORIGIN, COLLECTION_ADDRESS)).toThrow(
      message
    )
  })
})
