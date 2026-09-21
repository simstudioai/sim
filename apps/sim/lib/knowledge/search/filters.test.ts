/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'

describe('Assistant search scope', () => {
  it('keeps selected documents, source and date when the model omits filters', () => {
    const scope = {
      source: 'slack',
      modifiedAfter: '2026-09-01T00:00:00Z',
      documentIds: ['a', 'b'],
    }
    expect(intersectWorkspaceSearchFilters({}, scope)).toEqual(scope)
  })
  it('intersects document IDs and uses the later instant across time zones', () => {
    expect(
      intersectWorkspaceSearchFilters(
        { documentIds: ['a', 'outside'], modifiedAfter: '2026-09-02T01:00:00+03:00' },
        { documentIds: ['a', 'b'], modifiedAfter: '2026-09-01T23:00:00Z' }
      )
    ).toEqual({ documentIds: ['a'], modifiedAfter: '2026-09-01T23:00:00Z' })
  })
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
