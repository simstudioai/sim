/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { scopeAtlassianQuery } from '@/lib/sim-search/live/atlassian'
import { searchDrive } from '@/lib/sim-search/live/google'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { searchWithinPolicy } from '@/lib/sim-search/live/scoped-search'
import type { NativeClient, NativeSearchInput } from '@/lib/sim-search/live/types'

const input = (included: string[]): NativeSearchInput => ({
  query: 'incident',
  limit: 10,
  policy: { ...defaultLiveSearchPolicy(), mode: 'selected', included },
})

describe('scoped native query composition', () => {
  it.each(['github', 'slack'] as const)(
    'preserves %s continuation when targeting one permitted source',
    async (provider) => {
      const search = vi.fn(async (_input: NativeSearchInput) => ({
        documents: [],
        nextCursor: 'next',
      }))
      const request = {
        ...input([provider === 'github' ? 'org/repo' : 'C123']),
        native: { provider, cursor: 'previous' },
      }
      expect(await searchWithinPolicy(provider, null, request, search)).toMatchObject({
        nextCursor: 'next',
      })
      expect(search.mock.calls[0]?.[0].native.cursor).toBe('previous')
    }
  )
  it('searches an entire shared drive independently of the folder descendant toggle', async () => {
    const api: NativeClient = {
      json: vi.fn(async () => ({ files: [], nextPageToken: 'next' })),
      text: vi.fn(),
    }
    const request = input(['drive:shared'])
    request.policy!.includeSubfolders = false
    expect(
      await searchWithinPolicy('google_drive', api, request, (value) => searchDrive(api, value))
    ).toMatchObject({ nextCursor: 'next' })
    expect(api.json).toHaveBeenCalledWith(
      '/drive/v3/files',
      expect.objectContaining({
        query: expect.objectContaining({
          corpora: 'drive',
          driveId: 'shared',
          q: "trashed = false and (fullText contains 'incident')",
        }),
      })
    )
  })
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
  it('uses current Coda document URIs while accepting legacy document targets', async () => {
    const search = vi.fn(async () => ({ documents: [] }))
    await searchWithinPolicy(
      'coda',
      null,
      {
        ...input(['allowed']),
        native: { provider: 'coda', project: 'coda://docs/allowed' },
      },
      search
    )
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        native: expect.objectContaining({ project: 'superhuman://docs/allowed' }),
      })
    )
    search.mockClear()
    expect(
      await searchWithinPolicy(
        'coda',
        null,
        { ...input(['allowed']), native: { provider: 'coda', project: 'superhuman://docs/other' } },
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
