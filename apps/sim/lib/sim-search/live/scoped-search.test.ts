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
  it.each(['jama', 'flow'] as const)(
    'targets approved %s projects with bounded fanout and no scope widening',
    async (provider) => {
      const search = async (request: NativeSearchInput) => ({
        documents: [
          {
            id: `item-${request.native?.project ?? 'unscoped'}`,
            container: request.native?.project,
            title: 'Current item',
            url: 'https://provider.example/item',
            content: 'Current source content',
          },
        ],
      })
      const policyInput: NativeSearchInput = {
        ...input(['1', '2', '3', '4', '5', '6', '7', '8']),
        scopes: [],
        policy: {
          ...defaultLiveSearchPolicy(),
          mode: 'selected',
          included: ['1', '2', '3', '4', '5', '6', '7', '8'],
          excluded: ['2'],
        },
      }
      const result = await searchWithinPolicy(provider, null, policyInput, search)
      expect(result.documents.map((document) => document.container)).toEqual([
        '1',
        '3',
        '4',
        '5',
        '6',
        '7',
      ])
      expect(result.partial).toBe(true)
      expect(
        await searchWithinPolicy(
          provider,
          null,
          {
            ...policyInput,
            native: { provider, query: 'incident', project: '2' },
          },
          search
        )
      ).toEqual({ documents: [] })
      const narrowed = await searchWithinPolicy(
        provider,
        null,
        {
          ...policyInput,
          native: { provider, query: 'incident', project: '8', cursor: '10' },
        },
        search
      )
      expect(narrowed.documents.map((document) => document.container)).toEqual(['8'])
    }
  )
})
