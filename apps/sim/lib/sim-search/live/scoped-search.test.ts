import { describe, expect, it, vi } from 'vitest'
import { scopeAtlassianQuery } from '@/lib/sim-search/live/atlassian'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { searchWithinPolicy } from '@/lib/sim-search/live/scoped-search'
import type { NativeSearchInput } from '@/lib/sim-search/live/types'

const input = (included: string[]): NativeSearchInput => ({
  query: 'incident',
  limit: 10,
  policy: { ...defaultLiveSearchPolicy(), mode: 'selected', included },
})

describe('scoped native query composition', () => {
  it('does not let a native repository override organization scope', async () => {
    const search = vi.fn()
    expect(
      await searchWithinPolicy(
        'github',
        null,
        {
          ...input(['org/allowed']),
          native: { provider: 'github', query: 'repo:org/private incident' },
        },
        search
      )
    ).toEqual({ documents: [] })
    expect(search).not.toHaveBeenCalled()
  })
  it('places scope ahead of ordering and ignores order keywords inside quoted values', () => {
    expect(
      scopeAtlassianQuery(
        'text ~ "order by" OR status = Open ORDER BY updated DESC',
        'project = "ENG"'
      )
    ).toBe('(text ~ "order by" OR status = Open) AND project = "ENG" ORDER BY updated DESC')
    expect(scopeAtlassianQuery('ORDER BY updated DESC', 'project = "ENG"')).toBe(
      'project = "ENG" ORDER BY updated DESC'
    )
    expect(scopeAtlassianQuery('space = TEAM')).toBe('space = TEAM')
  })
})
