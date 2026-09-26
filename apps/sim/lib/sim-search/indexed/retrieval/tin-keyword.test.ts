import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { SearchBudget, SearchDeadlineError } from '@/lib/knowledge/search/budget'
import { resolveTinKeywordQuery } from '@/lib/sim-search/indexed/retrieval/tin-keyword'

/** Readiness is cached per process; the incomplete-index case lives in its own file, where the cache starts empty. */
describe('resolveTinKeywordQuery', () => {
  let indexValid: boolean
  let rendered: string

  beforeEach(() => {
    resetDbChainMock()
    indexValid = true
    rendered = "'releas' & 'note'"
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const text = JSON.stringify(query)
      if (text.includes('indisvalid')) return indexValid ? [{ valid: true }] : [{ valid: false }]
      if (text.includes('websearch_to_tsquery')) return [{ rendered }]
      return []
    })
  })

  it('translates the analyzed query', async () => {
    expect(await resolveTinKeywordQuery('release notes', 'english', undefined)).toBe(
      '("releas" AND "note")'
    )
  })

  it('reads under the keyword budget, so an expired deadline ends the leg instead of querying', async () => {
    const expired = new SearchBudget('keyword', performance.now() - 1)
    await expect(
      resolveTinKeywordQuery('release notes', 'english', expired)
    ).rejects.toBeInstanceOf(SearchDeadlineError)
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('falls back to GIN instead of failing the search when the query cannot be analyzed', async () => {
    dbChainMockFns.execute.mockRejectedValue(new Error('connection reset'))
    expect(await resolveTinKeywordQuery('release notes', 'english', undefined)).toBeNull()
  })
})
