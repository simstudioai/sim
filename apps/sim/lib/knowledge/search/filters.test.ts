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
  it('rejects a different source or disjoint document selection', () => {
    expect(() =>
      intersectWorkspaceSearchFilters({ source: 'gitlab' }, { source: 'slack' })
    ).toThrow('outside this search')
    expect(() =>
      intersectWorkspaceSearchFilters({ documentIds: ['a'] }, { documentIds: ['b'] })
    ).toThrow('outside this search')
  })
})
