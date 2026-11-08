import { describe, expect, it } from 'vitest'
import { liveCitationId } from '@/lib/knowledge/search/citation'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { encodeLiveReference, liveReferenceOwner } from '@/lib/sim-search/live/reference'

const owner = liveReferenceOwner('reader', 'workspace:w')
const fields = {
  account: 'account',
  provider: 'slack' as const,
  id: '1730912345.123456',
  container: 'C1',
}
/** One Slack message in the current ID form and in the earlier form older conversations hold. */
const currentId = encodeLiveReference(fields, owner)
const earlierId = `live:${Buffer.from(
  JSON.stringify({ v: 1, user: 'reader', scope: 'workspace:w', ...fields })
).toString('base64url')}`

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

  it('keeps a requested document the user selected in the other ID form', () => {
    expect(
      intersectWorkspaceSearchFilters({ documentIds: [currentId] }, { documentIds: [earlierId] })
    ).toEqual({ documentIds: [currentId] })
    expect(
      intersectWorkspaceSearchFilters({ documentIds: [earlierId] }, { documentIds: [currentId] })
    ).toEqual({ documentIds: [earlierId] })
  })
})

describe('live citation IDs', () => {
  it('cite one document as one source whichever ID form named it', () => {
    expect(liveCitationId(earlierId)).toBe(liveCitationId(currentId))
    expect(liveCitationId(currentId)).not.toBe(
      liveCitationId(encodeLiveReference({ ...fields, id: '1730912345.123457' }, owner))
    )
  })
})
