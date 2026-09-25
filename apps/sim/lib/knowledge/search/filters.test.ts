import { describe, expect, it } from 'vitest'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'

describe('Assistant search scope', () => {
  it('keeps the narrower end of a date window and refuses an empty one', () => {
    expect(
      intersectWorkspaceSearchFilters(
        { modifiedAfter: '2026-09-01T00:00:00.000Z', modifiedBefore: '2026-09-30T00:00:00.000Z' },
        { modifiedAfter: '2026-09-10T00:00:00.000Z', modifiedBefore: '2026-09-20T00:00:00.000Z' }
      )
    ).toEqual({
      modifiedAfter: '2026-09-10T00:00:00.000Z',
      modifiedBefore: '2026-09-20T00:00:00.000Z',
    })
    expect(() =>
      intersectWorkspaceSearchFilters(
        { modifiedAfter: '2026-09-25T00:00:00.000Z' },
        { modifiedBefore: '2026-09-20T00:00:00.000Z' }
      )
    ).toThrow('outside this search')
  })

  it('rejects a different source or disjoint document selection', () => {
    expect(() =>
      intersectWorkspaceSearchFilters({ source: 'gitlab' }, { source: 'slack' })
    ).toThrow('outside this search')
    expect(() =>
      intersectWorkspaceSearchFilters({ documentIds: ['a'] }, { documentIds: ['b'] })
    ).toThrow('outside this search')
  })
})
