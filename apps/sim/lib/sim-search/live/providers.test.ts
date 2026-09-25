import { describe, expect, it, vi } from 'vitest'
import { readGitHub, searchGitHub } from '@/lib/sim-search/live/github'
import { searchCalendar, searchDrive } from '@/lib/sim-search/live/google'
import { searchSlack } from '@/lib/sim-search/live/slack'
import type { NativeClient } from '@/lib/sim-search/live/types'

function client() {
  return { json: vi.fn<NativeClient['json']>(), text: vi.fn<NativeClient['text']>() }
}
const input = { query: 'launch', limit: 20, scopes: [] }

describe('native search endpoints', () => {
  it('uses escaped Drive fullText and includes shared-drive results without an index', async () => {
    const api = client()
    api.json.mockResolvedValue({
      files: [{ id: 'doc', name: 'Launch', mimeType: 'application/vnd.google-apps.document' }],
      nextPageToken: 'next',
      incompleteSearch: true,
    })
    const result = await searchDrive(api, { ...input, query: "owner's \\ launch" })
    expect(api.json).toHaveBeenCalledWith(
      '/drive/v3/files',
      expect.objectContaining({
        query: expect.objectContaining({
          q: "trashed = false and (fullText contains 'owner\\'s \\\\ launch')",
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        }),
      })
    )
    expect(result).toMatchObject({ nextCursor: 'next', partial: true, documents: [{ id: 'doc' }] })
  })
  it('marks a meeting shared across calendars as one item, primary calendar first', async () => {
    const api = client()
    const shared = (calendar: string, dateTime: string) => ({
      id: 'meeting',
      iCalUID: 'meeting@google.com',
      summary: 'Pilot planning',
      htmlLink: `https://calendar.google.com/${calendar}`,
      start: { dateTime },
    })
    api.json
      .mockResolvedValueOnce({
        items: [{ id: 'teammate@example.com' }, { id: 'member@example.com', primary: true }],
      })
      .mockResolvedValueOnce({ items: [shared('me', '2026-09-24T09:00:00-07:00')] })
      .mockResolvedValueOnce({ items: [shared('emir', '2026-09-24T12:00:00-04:00')] })
    const result = await searchCalendar(api, input)
    expect(result.documents.map((item) => item.container)).toEqual([
      'member@example.com',
      'teammate@example.com',
    ])
    expect(new Set(result.documents.map((item) => item.dedupeKey)).size).toBe(1)
    expect(api.json.mock.calls[1][0]).toContain('member%40example.com')
  })
  it('interleaves GitHub kinds before batches so one kind cannot crowd out another', async () => {
    const api = client()
    const repositories = Array.from({ length: 100 }, (_, index) => ({
      full_name: `simstudioai/repository-with-a-long-name-${index}`,
    }))
    api.json.mockImplementation(async (path) => {
      if (path === '/user/repos') return repositories
      return path === '/search/code'
        ? { items: [{ path: 'src/a.ts', repository: { full_name: 'org/repo' } }], total_count: 1 }
        : { items: [{ number: 1, title: 'Issue' }], total_count: 1 }
    })
    const result = await searchGitHub(api, input)
    const count = (path: string) => api.json.mock.calls.filter(([called]) => called === path).length
    expect(count('/search/code')).toBeGreaterThan(count('/search/issues') / 2)
    expect(result.documents.slice(0, 2).map(({ kind }) => kind)).toEqual(['issues', 'code'])
  })
  it("explains GitHub's search text limit instead of sending an oversized query", async () => {
    const api = client()
    await expect(
      searchGitHub(api, {
        ...input,
        native: { provider: 'github', query: `repo:org/repo ${'word '.repeat(60)}`, kind: 'code' },
      })
    ).rejects.toThrow('limited to 256 characters')
    expect(api.json).not.toHaveBeenCalled()
  })
  it('keeps GitHub qualifiers outside the grouped text of a dated search', async () => {
    const api = client()
    api.json.mockImplementation(async (path) =>
      path === '/user/repos' ? [{ full_name: 'org/repo' }] : { items: [], total_count: 0 }
    )
    await searchGitHub(api, {
      ...input,
      filters: { startDate: '2026-09-20T00:00:00Z', endDate: '2026-09-24T00:00:00Z' },
    })
    const searches = api.json.mock.calls.filter(([path]) => path.startsWith('/search/'))
    expect(searches.map(([path]) => path)).toEqual(['/search/issues', '/search/issues'])
    expect(searches.map(([, options]) => options?.query?.q)).toEqual([
      '(launch) repo:org/repo is:issue updated:2026-09-20T00:00:00.000Z..2026-09-24T00:00:00.000Z',
      '(launch) repo:org/repo is:pull-request updated:2026-09-20T00:00:00.000Z..2026-09-24T00:00:00.000Z',
    ])
  })
  it('bounds GitHub commit search dates to one author-date range', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [], total_count: 0 })
    await searchGitHub(api, {
      ...input,
      native: { provider: 'github', query: 'repo:org/repo author:octocat', kind: 'commits' },
      filters: { startDate: '2026-09-20T00:00:00Z', endDate: '2026-09-24T00:00:00Z' },
    })
    expect(api.json.mock.calls[0][1]?.query?.q).toBe(
      'repo:org/repo author:octocat author-date:2026-09-20T00:00:00.000Z..2026-09-24T00:00:00.000Z'
    )
  })
  it.each(['main', '../abc1234', 'abc12'])('rejects the GitHub commit reference %s', async (id) => {
    const api = client()
    await expect(readGitHub(api, id, 'org/repo', 'commits')).rejects.toThrow(
      'Invalid GitHub commit reference'
    )
    expect(api.json).not.toHaveBeenCalled()
  })
  it('calls Slack RTS with only channel types granted by the user token', async () => {
    const api = client()
    api.json.mockResolvedValue({
      ok: true,
      results: {
        messages: [
          {
            message_ts: '123.456',
            channel_id: 'C1',
            channel_name: 'team',
            content: 'Launch',
            permalink: 'https://team.slack.com/archives/C1/p123456',
          },
        ],
      },
      response_metadata: { next_cursor: 'next' },
    })
    const result = await searchSlack(api, {
      ...input,
      limit: 50,
      scopes: ['search:read.public', 'search:read.im'],
      native: {
        provider: 'slack',
        query: 'launch',
        termClauses: ['launch OR release'],
        keywordOnly: true,
      },
    })
    expect(api.json).toHaveBeenCalledWith('/api/assistant.search.context', {
      body: {
        query: 'launch',
        channel_types: ['public_channel', 'im'],
        include_archived_channels: true,
        content_types: ['messages'],
        include_context_messages: true,
        limit: 20,
        term_clauses: ['launch OR release'],
        disable_semantic_search: true,
      },
    })
    expect(result.nextCursor).toBe('next')
  })
  it('scopes ordinary GitHub code and issue searches to affiliated repositories and separates PRs', async () => {
    const api = client()
    api.json.mockImplementation(async (path) =>
      path === '/user/repos' ? [{ full_name: 'my-org/repo' }] : { items: [], total_count: 0 }
    )
    await searchGitHub(api, input)
    const searches = api.json.mock.calls.filter(([path]) => path.startsWith('/search/'))
    expect(searches).toHaveLength(3)
    expect(searches.every(([, options]) => options?.query?.q?.includes('repo:my-org/repo'))).toBe(
      true
    )
    expect(
      searches.filter(([path]) => path === '/search/issues').map(([, options]) => options?.query?.q)
    ).toEqual(['launch repo:my-org/repo is:issue', 'launch repo:my-org/repo is:pull-request'])
    expect(searches.some(([path]) => path === '/search/code')).toBe(true)
  })
  it('never falls back to public GitHub when the connection has no repositories', async () => {
    const api = client()
    api.json.mockResolvedValue([])
    expect((await searchGitHub(api, input)).documents).toEqual([])
    expect(api.json).toHaveBeenCalledTimes(1)
  })
  it('never replaces missing Slack RTS consent with a bot or indexed lookup', async () => {
    const api = client()
    await expect(searchSlack(api, input)).rejects.toMatchObject({ status: 'reconnect' })
    expect(api.json).not.toHaveBeenCalled()
  })
})
