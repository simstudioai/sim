import { describe, expect, it, vi } from 'vitest'
import { readGitHub, searchGitHub } from '@/lib/sim-search/live/github'
import { searchCalendar, searchDrive } from '@/lib/sim-search/live/google'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { searchSlack } from '@/lib/sim-search/live/slack'
import type { NativeClient } from '@/lib/sim-search/live/types'

function client() {
  return {
    json: vi.fn<NativeClient['json']>(),
    text: vi.fn<NativeClient['text']>(),
    bytes: vi.fn<NativeClient['bytes']>(),
  }
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
        content_types: ['messages', 'channels'],
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

describe('Slack RTS pages', () => {
  const scopes = ['search:read.public']
  const slackPage = (first: number, count: number, nextCursor?: string) => ({
    ok: true,
    results: {
      messages: Array.from({ length: count }, (_, index) => ({
        message_ts: `${first + index}.000100`,
        channel_id: 'C1',
        channel_name: 'team',
        content: 'Launch',
        permalink: `https://team.slack.com/archives/C1/p${first + index}000100`,
      })),
    },
    response_metadata: { next_cursor: nextCursor ?? '' },
  })
  const sentBodies = (api: ReturnType<typeof client>) =>
    api.json.mock.calls.map(([, options]) => options?.body as Record<string, unknown>)

  it('follows the cursor until a native Slack query fills its limit', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(slackPage(1, 20, 'page-2'))
      .mockResolvedValueOnce(slackPage(21, 20, 'page-3'))
    const result = await searchSlack(api, {
      ...input,
      limit: 30,
      scopes,
      native: { provider: 'slack', query: 'launch' },
    })
    expect(sentBodies(api).map(({ cursor, limit }) => ({ cursor, limit }))).toEqual([
      { cursor: undefined, limit: 20 },
      { cursor: 'page-2', limit: 10 },
    ])
    expect(result.documents).toHaveLength(40)
    expect(result.nextCursor).toBe('page-3')
    expect(result.partial).toBeUndefined()
  })

  it('pages a plain query scoped to the Slack source', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(slackPage(1, 20, 'page-2'))
      .mockResolvedValueOnce(slackPage(21, 5))
    const result = await searchSlack(api, {
      ...input,
      limit: 50,
      scopes,
      filters: { source: 'slack' },
    })
    expect(api.json).toHaveBeenCalledTimes(2)
    expect(result.documents).toHaveLength(25)
    expect(result.nextCursor).toBeUndefined()
  })

  it('reads one page for a search across every source, whatever its limit', async () => {
    const api = client()
    api.json.mockResolvedValue(slackPage(1, 20, 'page-2'))
    const result = await searchSlack(api, { ...input, limit: 30, scopes })
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(result.nextCursor).toBe('page-2')
  })

  it('stops when Slack reports no further page', async () => {
    const api = client()
    api.json.mockResolvedValue(slackPage(1, 12))
    await searchSlack(api, {
      ...input,
      limit: 50,
      scopes,
      native: { provider: 'slack', query: 'launch' },
    })
    expect(api.json).toHaveBeenCalledTimes(1)
  })

  it('reads at most three pages', async () => {
    const api = client()
    api.json.mockImplementation(async (_path, options) => {
      const cursor = (options?.body as { cursor?: string }).cursor
      const index = cursor ? Number(cursor) : 0
      return slackPage(index * 20 + 1, 1, String(index + 1))
    })
    const result = await searchSlack(api, {
      ...input,
      limit: 100,
      scopes,
      native: { provider: 'slack', query: 'launch' },
    })
    expect(api.json).toHaveBeenCalledTimes(3)
    expect(result.nextCursor).toBe('3')
  })

  it('stops once matched files fill the limit alongside messages', async () => {
    const api = client()
    const withFiles = slackPage(1, 20, 'page-2')
    api.json.mockResolvedValue({
      ...withFiles,
      results: {
        ...withFiles.results,
        files: Array.from({ length: 10 }, (_, index) => ({
          file_id: `F${index}`,
          title: 'Launch plan',
          permalink: `https://team.slack.com/files/F${index}`,
        })),
      },
    })
    const result = await searchSlack(api, {
      ...input,
      limit: 30,
      scopes: [...scopes, 'search:read.files'],
      native: { provider: 'slack', query: 'launch' },
    })
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(result.documents).toHaveLength(30)
  })

  it('keeps earlier pages and the unread cursor when a later page fails', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(slackPage(1, 20, 'page-2'))
      .mockResolvedValueOnce({ ok: false, error: 'ratelimited' })
    const result = await searchSlack(api, {
      ...input,
      limit: 50,
      scopes,
      native: { provider: 'slack', query: 'launch' },
    })
    expect(result.documents).toHaveLength(20)
    expect(result.nextCursor).toBe('page-2')
    expect(result.partial).toBe(true)
    expect(result.message).toContain('nextCursor')
  })

  it('keeps earlier pages when a later page fails outside the Slack API', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(slackPage(1, 20, 'page-2'))
      .mockRejectedValueOnce(new Error('socket hang up'))
    const result = await searchSlack(api, {
      ...input,
      limit: 50,
      scopes,
      native: { provider: 'slack', query: 'launch' },
    })
    expect(result.documents).toHaveLength(20)
    expect(result.nextCursor).toBe('page-2')
    expect(result.partial).toBe(true)
  })

  it('stops paging once the caller cancels the search', async () => {
    const api = client()
    const cancelled = new AbortController()
    api.json.mockResolvedValueOnce(slackPage(1, 20, 'page-2')).mockImplementationOnce(async () => {
      cancelled.abort()
      throw new Error('aborted')
    })
    await expect(
      searchSlack(api, {
        ...input,
        limit: 50,
        scopes,
        signal: cancelled.signal,
        native: { provider: 'slack', query: 'launch' },
      })
    ).rejects.toThrow('aborted')
  })

  it('keeps paging past short pages that still carry a cursor', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(slackPage(1, 10, 'page-2'))
      .mockResolvedValueOnce(slackPage(11, 10, 'page-3'))
      .mockResolvedValueOnce(slackPage(21, 10))
    const result = await searchSlack(api, {
      ...input,
      limit: 30,
      scopes,
      native: { provider: 'slack', query: 'launch' },
    })
    expect(api.json).toHaveBeenCalledTimes(3)
    expect(result.documents).toHaveLength(30)
  })

  it('still fails when the first page fails', async () => {
    const api = client()
    api.json.mockResolvedValue({ ok: false, error: 'ratelimited' })
    await expect(
      searchSlack(api, {
        ...input,
        limit: 50,
        scopes,
        native: { provider: 'slack', query: 'launch' },
      })
    ).rejects.toMatchObject({ status: 'rate_limited' })
  })
})

describe('Slack channels', () => {
  const scopes = ['search:read.public', 'search:read.private']
  const channel = (id: string, name: string, archived = false) => ({
    name,
    is_archived: archived,
    permalink: `https://team.slack.com/archives/${id}`,
  })
  const rts = (channels: unknown[], messages: unknown[] = []) => ({
    ok: true,
    results: { messages, channels },
  })

  it('names the channels a query matches that the source settings let it search', async () => {
    const api = client()
    api.json.mockResolvedValue(
      rts([
        channel('C1', 'announcements'),
        channel('G2', 'announce-leads'),
        channel('C3', 'announce-old', true),
      ])
    )
    const result = await searchSlack(api, {
      ...input,
      scopes,
      policy: { ...defaultLiveSearchPolicy('slack'), excluded: ['G2'], includeArchived: false },
      native: { provider: 'slack', query: 'announcements' },
    })
    expect(result.message).toContain('Channels matching the query: #announcements (in:<#C1>).')
    expect(result.message).not.toContain('announce-leads')
    expect(result.message).not.toContain('announce-old')
  })

  it('says a filtered channel exists when none of its messages match', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(rts([]))
      .mockResolvedValueOnce(rts([channel('C9', 'launch-team'), channel('C8', 'launch-team-ops')]))
    const result = await searchSlack(api, {
      ...input,
      query: '',
      scopes,
      filters: { startDate: '2026-10-30T00:00:00Z' },
      native: { provider: 'slack', query: '', modifiers: 'in:#Launch-Team' },
    })
    expect(result.documents).toEqual([])
    expect(result.message).toContain(
      '#launch-team (in:<#C9>) exists; none of its messages matched this query and date window.'
    )
  })

  it('says no channel has the filtered name and names the similar ones', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(rts([]))
      .mockResolvedValueOnce(rts([channel('C7', 'company-announcements')]))
    const result = await searchSlack(api, {
      ...input,
      query: '',
      scopes,
      filters: { startDate: '2026-10-30T00:00:00Z' },
      native: { provider: 'slack', query: '', modifiers: 'in:#announcements' },
    })
    expect(result.message).toContain('No channel named #announcements is visible to this account.')
    expect(result.message).toContain(
      'Channels with similar names: #company-announcements (in:<#C7>).'
    )
  })

  it('keeps the empty search when the channel lookup fails', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce(rts([]))
      .mockResolvedValueOnce({ ok: false, error: 'ratelimited' })
    const result = await searchSlack(api, {
      ...input,
      query: '',
      scopes,
      filters: { startDate: '2026-10-30T00:00:00Z' },
      native: { provider: 'slack', query: '', modifiers: 'in:#announcements' },
    })
    expect(result.documents).toEqual([])
    expect(result.message).not.toContain('#announcements')
  })
})
