/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { SearchBudget, SearchDeadlineError } from '@/lib/knowledge/search/budget'
import { resolveTinKeywordQuery } from '@/lib/knowledge/search/tin-keyword'

/**
 * Base kinds are cached per process, so each case uses its own bases. Readiness is cached too;
 * the incomplete-index case lives in its own file, where the cache starts empty.
 */
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

  it('is off while the rollout flag is off, without touching the database', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    expect(
      await resolveTinKeywordQuery(['kb-flag-off'], 'release notes', 'english', undefined)
    ).toBeNull()
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('translates the analyzed query once every base is a search index', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-index', isSearchIndex: true }])
    expect(await resolveTinKeywordQuery(['kb-index'], 'release notes', 'english', undefined)).toBe(
      '("releas" AND "note")'
    )
  })

  it('is off when any base is not a search index, since only those are projected', async () => {
    queueTableRows(schemaMock.knowledgeBase, [
      { id: 'kb-index-2', isSearchIndex: true },
      { id: 'kb-plain', isSearchIndex: false },
    ])
    expect(
      await resolveTinKeywordQuery(
        ['kb-index-2', 'kb-plain'],
        'release notes',
        'english',
        undefined
      )
    ).toBeNull()
  })

  it('is off for a query Tin cannot express', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-negation', isSearchIndex: true }])
    rendered = "!'draft'"
    expect(await resolveTinKeywordQuery(['kb-negation'], '-draft', 'english', undefined)).toBeNull()
  })

  it('reads under the keyword budget, so an expired deadline ends the leg instead of querying', async () => {
    const expired = new SearchBudget('keyword', performance.now() - 1)
    await expect(
      resolveTinKeywordQuery(['kb-expired'], 'release notes', 'english', expired)
    ).rejects.toBeInstanceOf(SearchDeadlineError)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('falls back to GIN instead of failing the search when readiness cannot be read', async () => {
    mockIsFeatureEnabled.mockRejectedValue(new Error('config unavailable'))
    expect(
      await resolveTinKeywordQuery(['kb-error'], 'release notes', 'english', undefined)
    ).toBeNull()
  })
})
