import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { SearchBudget, SearchDeadlineError } from '@/lib/knowledge/search/budget'
import { resolveTinKeywordQuery } from '@/lib/knowledge/search/tin-keyword'

/** Readiness is cached per process; the incomplete-index case lives in its own file, where the cache starts empty. */
describe('resolveTinKeywordQuery', () => {
  let indexValid: boolean
  let rendered: string

  beforeEach(() => {
    resetDbChainMock()
    mockIsFeatureEnabled.mockResolvedValue(true)
    indexValid = true
    rendered = "'releas' & 'note'"
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const text = JSON.stringify(query)
      if (text.includes('indisvalid')) return indexValid ? [{ valid: true }] : [{ valid: false }]
      if (text.includes('websearch_to_tsquery')) return [{ rendered }]
      return []
    })
  })

  it('translates the analyzed query when every base is a search index', async () => {
    expect(await resolveTinKeywordQuery(true, 'release notes', 'english', undefined)).toBe(
      '("releas" AND "note")'
    )
  })

  it('reads under the keyword budget, so an expired deadline ends the leg instead of querying', async () => {
    const expired = new SearchBudget('keyword', performance.now() - 1)
    await expect(
      resolveTinKeywordQuery(true, 'release notes', 'english', expired)
    ).rejects.toBeInstanceOf(SearchDeadlineError)
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('falls back to GIN instead of failing the search when readiness cannot be read', async () => {
    mockIsFeatureEnabled.mockRejectedValue(new Error('config unavailable'))
    expect(await resolveTinKeywordQuery(true, 'release notes', 'english', undefined)).toBeNull()
  })
})
