/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  accessRequestSearchParams,
  accessReviewSearchParams,
} from '@/ee/access-requests/components/search-params'

describe('access request URL bounds', () => {
  it.each(['-1', '1.5', '40001', '1e3', '999999999999999999999'])(
    'rejects invalid page %s before deriving an API offset',
    (value) => {
      expect(accessRequestSearchParams.page.parse(value)).toBeNull()
      expect(accessReviewSearchParams['request-page'].parse(value)).toBeNull()
    }
  )
  it('accepts valid pages and bounded search/deep-link values', () => {
    expect(accessRequestSearchParams.page.parse('40000')).toBe(40000)
    expect(accessRequestSearchParams.requestId.parse('request-1')).toBe('request-1')
    expect(accessRequestSearchParams.requestId.parse('x'.repeat(129))).toBeNull()
    expect(accessRequestSearchParams.search.parse('x'.repeat(201))).toBeNull()
    expect(accessReviewSearchParams['request-search'].parse('Tables')).toBe('Tables')
    expect(accessReviewSearchParams['request-search'].parse('x'.repeat(201))).toBeNull()
  })
})
