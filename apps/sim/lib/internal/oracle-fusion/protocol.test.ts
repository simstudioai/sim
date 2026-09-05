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
        { items: [], count: 0, hasMore: false, limit: 25, offset: 10, totalResults: 5 },
        (item) => item,
        { expectedOffset: 10 }
      )
    ).toEqual({
      items: [],
      count: 0,
      hasMore: false,
      limit: 25,
      offset: 10,
      totalResults: 5,
      nextOffset: 10,
    })
  })

  it.each([
    { items: [], count: 0, hasMore: false, limit: 25, offset: 5, totalResults: 6 },
    { items: [{}], count: 1, hasMore: false, limit: 25, offset: 5, totalResults: 7 },
    { items: [{}], count: 1, hasMore: true, limit: 25, offset: 5, totalResults: 6 },
    { items: [{}], count: 1, hasMore: false, limit: 25, offset: 4, totalResults: 4 },
    { items: [{}], count: 1, hasMore: true, limit: 25, offset: 5, totalResults: 4 },
    { items: [{}], count: 1, hasMore: false, limit: 25, offset: 5, totalResults: 0 },
    { items: [{}], count: 1, hasMore: true, limit: 25, offset: 5, totalResults: 0 },
  ])('preserves estimated totals independently of pagination metadata %#', (value) => {
    expect(parseOracleFusionCollection(value, (item) => item)).toEqual({
      ...value,
      nextOffset: value.offset + value.count,
    })
  })

  it.each(
    [
      -1,
      0.5,
      '1',
      null,
      true,
      {},
      [],
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((totalResults) => ({ totalResults }))
  )('rejects malformed estimated total $totalResults', ({ totalResults }) => {
    const parseItem = vi.fn((item) => item)
    expect(() =>
      parseOracleFusionCollection(
        { items: [{}], count: 1, hasMore: false, limit: 25, offset: 0, totalResults },
        parseItem
      )
    ).toThrow('Oracle collection totalResults must be a non-negative safe integer')
    expect(parseItem).not.toHaveBeenCalled()
  })

  it('does not synthesize an omitted total for a nonempty page', () => {
    const page = { items: [{}], count: 1, hasMore: true, limit: 25, offset: 5 }
    const result = parseOracleFusionCollection(page, (item) => item)

    expect(result).toEqual({ ...page, nextOffset: 6 })
    expect(result).not.toHaveProperty('totalResults')
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
    [
      { items: [{}], count: 1, hasMore: true, limit: 25, offset: Number.MAX_SAFE_INTEGER },
      'safe integer range',
    ],
  ])('rejects malformed collection envelope %#', (value, message) => {
    expect(() => parseOracleFusionCollection(value, (item) => item)).toThrow(message as string)
  })
})

describe.each(['legacy', 'context', 'both'] as const)('Oracle %s self links', (representation) => {
  function resource(href: unknown, otherLinks: unknown[] = []): Record<string, unknown> {
    const links = [{ rel: 'self', href }, ...otherLinks]
    return {
      ...(representation !== 'context' ? { links } : {}),
      ...(representation !== 'legacy'
        ? { '@context': { key: 'not-the-resource-key', links } }
        : {}),
    }
  }

  it('accepts exactly one same-origin self link for the expected path', () => {
    expect(() =>
      validateOracleFusionSelfLink(resource(`${ORIGIN}${COLLECTION}/abc`), ORIGIN, {
        family: 'hcm',
        relativePath: 'workers/abc',
      })
    ).not.toThrow()
  })

  it('extracts item keys from a collection without trusting context keys or collection links', () => {
    const address = { family: 'fscm', relativePath: 'invoices' } as const
    const collectionPath = '/fscmRestApi/resources/11.13.18.05/invoices'
    const key = 'invoice:123,installment=2'
    const encodedKey = encodeOracleFusionPathSegment(key)
    const page = parseOracleFusionCollection(
      {
        items: [resource(`${ORIGIN}${collectionPath}/${encodedKey}`)],
        count: 1,
        limit: 25,
        offset: 0,
        hasMore: false,
        links: [{ rel: 'self', href: `${ORIGIN}${collectionPath}` }],
      },
      (item) => {
        validateOracleFusionSelfLink(item, ORIGIN, {
          ...address,
          relativePath: `invoices/${encodedKey}`,
        })
        return extractOracleFusionOpaqueKey(item, ORIGIN, address)
      }
    )

    expect(page.items).toEqual([key])
  })

  it('continues ignoring unrelated link relations and non-link entries', () => {
    const value = resource(`${ORIGIN}${COLLECTION}/abc`, [
      null,
      'not a link',
      [],
      { rel: 'canonical', href: 'unrelated' },
    ])
    expect(extractOracleFusionOpaqueKey(value, ORIGIN, COLLECTION_ADDRESS)).toBe('abc')
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
    [resource(`${ORIGIN}${COLLECTION}/abc#fragment`), 'credential-bound origin'],
    [
      resource(`${ORIGIN.replace('https://', 'https://user:password@')}${COLLECTION}/abc`),
      'credential-bound origin',
    ],
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

  it('requires spaces in self-link keys to be encoded and preserves their value', () => {
    const key = 'person name '
    const encoded = encodeOracleFusionPathSegment(key)
    expect(encoded).toBe('person%20name%20')
    expect(
      extractOracleFusionOpaqueKey(
        resource(`${ORIGIN}${COLLECTION}/${encoded}`),
        ORIGIN,
        COLLECTION_ADDRESS
      )
    ).toBe(key)
    expect(() =>
      extractOracleFusionOpaqueKey(
        resource(`${ORIGIN}${COLLECTION}/${key}`),
        ORIGIN,
        COLLECTION_ADDRESS
      )
    ).toThrow('Oracle self link is malformed')
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

  it.each(['\t', '\n', '\r'])(
    'rejects a self-link key containing the raw control character %j before URL parsing',
    (control) => {
      expect(() =>
        extractOracleFusionOpaqueKey(
          resource(`${ORIGIN}${COLLECTION}/bad${control}key`),
          ORIGIN,
          COLLECTION_ADDRESS
        )
      ).toThrow('Oracle self link is malformed')
    }
  )

  it.each([
    `${ORIGIN}${COLLECTION}/parent/../abc`,
    `${ORIGIN}${COLLECTION}/parent/%2e%2e/abc`,
    `${ORIGIN}${COLLECTION}/parent/.%2E/abc`,
    `${ORIGIN}${COLLECTION}/parent\\..\\abc`,
  ])('rejects a self-link path that URL parsing would normalize %j', (href) => {
    expect(() =>
      validateOracleFusionSelfLink(resource(href), ORIGIN, {
        family: 'hcm',
        relativePath: 'workers/abc',
      })
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

describe('Oracle self-link representation compatibility', () => {
  const href = `${ORIGIN}${COLLECTION}/abc`
  const links = [{ rel: 'self', href }]
  const detailAddress = { family: 'hcm', relativePath: 'workers/abc' } as const

  it('accepts legacy links alongside context metadata without a links property', () => {
    const value = { links, '@context': { key: 'not-the-resource-key', headers: { ETag: 'etag' } } }
    expect(extractOracleFusionOpaqueKey(value, ORIGIN, COLLECTION_ADDRESS)).toBe('abc')
    expect(() => validateOracleFusionSelfLink(value, ORIGIN, detailAddress)).not.toThrow()
  })

  it.each([undefined, null, [], 'context', 1].map((context) => ({ context })))(
    'rejects malformed context %# despite valid legacy links',
    ({ context }) => {
      const value = { links, '@context': context }
      expect(() => extractOracleFusionOpaqueKey(value, ORIGIN, COLLECTION_ADDRESS)).toThrow(
        'Oracle resource context must be an object'
      )
      expect(() => validateOracleFusionSelfLink(value, ORIGIN, detailAddress)).toThrow(
        'Oracle resource context must be an object'
      )
    }
  )

  it.each([{}, { '@context': {} }, { '@context': { key: 'abc' } }, { '@context': { links: [] } }])(
    'rejects missing self links without deriving a key from context %#',
    (value) => {
      expect(() => extractOracleFusionOpaqueKey(value, ORIGIN, COLLECTION_ADDRESS)).toThrow(
        'exactly one'
      )
      expect(() => validateOracleFusionSelfLink(value, ORIGIN, detailAddress)).toThrow(
        'exactly one'
      )
    }
  )

  describe.each(['legacy', 'context'] as const)('invalid %s links', (representation) => {
    it.each([
      { links: undefined, error: 'exactly one' },
      { links: null, error: 'exactly one' },
      { links: {}, error: 'exactly one' },
      { links: [], error: 'exactly one' },
      { links: [...links, ...links], error: 'exactly one' },
      { links: [{ rel: 'self' }], error: 'malformed' },
      { links: [{ rel: 'self', href: 'not a URL' }], error: 'malformed' },
      {
        links: [{ rel: 'self', href: `${ORIGIN}${COLLECTION}/parent/../abc` }],
        error: 'malformed',
      },
    ])(
      'does not fall back to the other valid representation %#',
      ({ links: invalidLinks, error }) => {
        const value = {
          links: representation === 'legacy' ? invalidLinks : links,
          '@context': { links: representation === 'context' ? invalidLinks : links },
        }
        expect(() => extractOracleFusionOpaqueKey(value, ORIGIN, COLLECTION_ADDRESS)).toThrow(error)
        expect(() => validateOracleFusionSelfLink(value, ORIGIN, detailAddress)).toThrow(error)
      }
    )
  })

  it.each([
    `${ORIGIN}${COLLECTION}/other`,
    `https://other.fa.us2.oraclecloud.com${COLLECTION}/abc`,
    `${ORIGIN.toUpperCase()}${COLLECTION}/abc`,
    `${ORIGIN}${COLLECTION}/%61bc`,
  ])('rejects conflicting href strings without normalizing or reflecting them %#', (otherHref) => {
    for (const [legacyHref, contextHref] of [
      [href, otherHref],
      [otherHref, href],
    ]) {
      const value = {
        links: [{ rel: 'self', href: legacyHref }],
        '@context': { links: [{ rel: 'self', href: contextHref }] },
      }
      expect(() => extractOracleFusionOpaqueKey(value, ORIGIN, COLLECTION_ADDRESS)).toThrow(
        new Error('Oracle response self-link representations conflict')
      )
      expect(() => validateOracleFusionSelfLink(value, ORIGIN, detailAddress)).toThrow(
        new Error('Oracle response self-link representations conflict')
      )
    }
  })
})
