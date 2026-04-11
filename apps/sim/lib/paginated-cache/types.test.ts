/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isPaginatedCacheReference } from '@/lib/paginated-cache/types'

describe('isPaginatedCacheReference', () => {
  it('returns true for a valid reference object', () => {
    const ref = {
      _type: 'paginated_cache_ref',
      cacheId: 'cache-123',
      totalPages: 5,
      totalItems: 250,
      pageField: 'tickets',
    }

    expect(isPaginatedCacheReference(ref)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isPaginatedCacheReference(null)).toBe(false)
  })

  it('returns false for an object missing _type', () => {
    const obj = {
      cacheId: 'cache-123',
      totalPages: 5,
      totalItems: 250,
      pageField: 'tickets',
    }

    expect(isPaginatedCacheReference(obj)).toBe(false)
  })

  it('returns false for an object with wrong _type value', () => {
    const obj = {
      _type: 'something_else',
      cacheId: 'cache-123',
      totalPages: 5,
      totalItems: 250,
      pageField: 'tickets',
    }

    expect(isPaginatedCacheReference(obj)).toBe(false)
  })

  it('returns false when a required field has the wrong type', () => {
    const obj = {
      _type: 'paginated_cache_ref',
      cacheId: 'cache-123',
      totalPages: '5',
      totalItems: 250,
      pageField: 'tickets',
    }

    expect(isPaginatedCacheReference(obj)).toBe(false)
  })
})
