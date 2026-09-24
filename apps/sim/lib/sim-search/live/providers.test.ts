/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { searchAtlassian } from '@/lib/sim-search/live/atlassian'
import { searchCoda } from '@/lib/sim-search/live/coda'
import { readGitHub, searchGitHub } from '@/lib/sim-search/live/github'
import { readGitLab, searchGitLab } from '@/lib/sim-search/live/gitlab'
import { readDrive, searchCalendar, searchDrive, searchGmail } from '@/lib/sim-search/live/google'
import { withJsonMemo } from '@/lib/sim-search/live/http'
import { readSlack, searchSlack } from '@/lib/sim-search/live/slack'
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
  it('passes native Drive syntax and continuation separately from the URL', async () => {
    const api = client()
    api.json.mockResolvedValue({ files: [] })
    await searchDrive(api, {
      ...input,
      native: {
        provider: 'google_drive',
        query: "name contains 'Q4' and mimeType = 'application/vnd.google-apps.presentation'",
        cursor: 'a&b',
      },
    })
    expect(api.json).toHaveBeenCalledWith(
      '/drive/v3/files',
      expect.objectContaining({
        query: expect.objectContaining({
          pageToken: 'a&b',
          q: expect.stringContaining("name contains 'Q4'"),
        }),
      })
    )
  })
  it('reads Sheets using the Sheets API and includes multiple sheets', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({
        id: 'sheet',
        name: 'Budget',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      })
      .mockResolvedValueOnce({
        sheets: [{ properties: { title: 'Q1' } }, { properties: { title: "Q2's" } }],
      })
      .mockResolvedValueOnce({
        valueRanges: [
          { range: 'Q1!A1', values: [['Revenue', 42]] },
          { range: "Q2's!A1", values: [['Revenue', 43]] },
        ],
      })
    const result = await readDrive(api, 'sheet')
    expect(api.json).toHaveBeenLastCalledWith('/v4/spreadsheets/sheet/values:batchGet', {
      googleService: 'sheets',
      query: {
        ranges: ["'Q1'!A1:AZ1000", "'Q2''s'!A1:AZ1000"],
        valueRenderOption: 'FORMATTED_VALUE',
      },
    })
    expect(result.content).toContain('42')
    expect(result.content).toContain('43')
  })
  it('keeps Gmail operators and resolves message metadata', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({ messages: [{ id: 'm' }], nextPageToken: 'n' })
      .mockResolvedValueOnce({
        id: 'm',
        snippet: 'Launch meeting',
        internalDate: '1700000000000',
        payload: { headers: [{ name: 'Subject', value: 'Meeting' }] },
      })
    const result = await searchGmail(api, {
      ...input,
      native: { provider: 'gmail', query: 'from:alice@example.com after:2026/09/01' },
    })
    expect(result.documents[0].title).toBe('Meeting')
    expect(api.json.mock.calls[0][1]?.query?.q).toBe('from:alice@example.com after:2026/09/01')
    expect(result.nextCursor).toBe('n')
  })
  it('searches every returned calendar, not only primary', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({ items: [{ id: 'primary' }, { id: 'team@example.com' }] })
      .mockResolvedValueOnce({ items: [{ id: 'mine', summary: 'Launch' }] })
      .mockResolvedValueOnce({ items: [{ id: 'team', summary: 'Launch review' }] })
    const result = await searchCalendar(api, input)
    expect(result.documents.map((item) => item.container)).toEqual(['primary', 'team@example.com'])
    expect(api.json.mock.calls[2][0]).toContain('team%40example.com')
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
  it('keeps recurring occurrences that share one iCalendar UID', async () => {
    const api = client()
    const occurrence = (day: string) => ({
      id: `standup_${day}`,
      iCalUID: 'standup@google.com',
      summary: 'Standup',
      start: { dateTime: `2026-09-${day}T09:00:00Z` },
    })
    api.json
      .mockResolvedValueOnce({ items: [{ id: 'primary', primary: true }] })
      .mockResolvedValueOnce({ items: [occurrence('24'), occurrence('25')] })
    const result = await searchCalendar(api, {
      ...input,
      query: '',
      filters: { startDate: '2026-09-24T00:00:00Z', endDate: '2026-09-26T00:00:00Z' },
    })
    expect(result.documents.map((item) => item.id)).toEqual(['standup_24', 'standup_25'])
    expect(result.documents[0]?.dedupeKey).not.toBe(result.documents[1]?.dedupeKey)
  })
  it('orders a dated agenda by start time across calendars', async () => {
    const api = client()
    const event = (id: string, hour: string) => ({
      id,
      summary: id,
      start: { dateTime: `2026-09-24T${hour}:00:00Z` },
    })
    api.json
      .mockResolvedValueOnce({ items: [{ id: 'primary', primary: true }, { id: 'team' }] })
      .mockResolvedValueOnce({ items: [event('late', '17'), event('later', '18')] })
      .mockResolvedValueOnce({ items: [event('early', '08')], nextPageToken: 'more' })
    const result = await searchCalendar(api, {
      ...input,
      query: '',
      filters: { startDate: '2026-09-24T00:00:00Z', endDate: '2026-09-25T00:00:00Z' },
    })
    expect(result.documents.map((item) => item.id)).toEqual(['early', 'late', 'later'])
    expect(result).toMatchObject({ hasMore: true, partial: false })
    expect(api.json.mock.calls[1][1]?.query).toMatchObject({
      singleEvents: 'true',
      orderBy: 'startTime',
    })
  })
  it('turns HTML event descriptions into readable text', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({ items: [{ id: 'primary', primary: true }] })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'e',
            summary: 'Demo',
            description:
              'Who:<br><a href="mailto:host@example.com">host@example.com</a><br>Where: <a href="https://www.google.com/url?q=https://meet.google.com/abc&amp;sa=D">https://meet.google.com/abc</a>',
          },
        ],
      })
    const [event] = (await searchCalendar(api, input)).documents
    expect(event.content).toContain('Who:\nhost@example.com\nWhere: https://meet.google.com/abc')
    expect(event.content).not.toContain('<a')
    expect(event.content).not.toContain('google.com/url')
  })
  it('requests only the Gmail metadata a result uses and cleans the snippet', async () => {
    const api = client()
    api.json.mockResolvedValueOnce({ messages: [{ id: 'm' }] }).mockResolvedValueOnce({
      id: 'm',
      labelIds: ['INBOX'],
      snippet: 'Let&#39;s ship it \u034f \u034f \u200c\u200b\ufeff \u034f',
      internalDate: '1700000000000',
      payload: { headers: [{ name: 'Subject', value: 'Launch' }] },
    })
    const [message] = (await searchGmail(api, input)).documents
    expect(message.content).toBe("Let's ship it")
    expect(message.accessMetadata).toEqual({ id: 'm', labelIds: ['INBOX'] })
    expect(api.json.mock.calls[1][1]?.query).toMatchObject({
      format: 'metadata',
      metadataHeaders: ['Subject', 'From'],
      fields: 'id,labelIds,snippet,internalDate,payload/headers',
    })
  })
  it('batches code search by bytes and searches issues in fewer, larger batches', async () => {
    const api = client()
    const repositories = Array.from({ length: 100 }, (_, index) => ({
      full_name: `simstudioai/repository-with-a-long-name-${index}`,
    }))
    api.json.mockImplementation(async (path) =>
      path === '/user/repos' ? repositories : { items: [], total_count: 0 }
    )
    const result = await searchGitHub(api, { ...input, query: 'déploiement 検索' })
    const queries = (path: string) =>
      api.json.mock.calls
        .filter(([called]) => called === path)
        .map(([, options]) => Buffer.byteLength(String(options?.query?.q)))
    expect(Math.max(...queries('/search/code'))).toBeLessThanOrEqual(1000)
    expect(queries('/search/code').length).toBeLessThanOrEqual(4)
    expect(queries('/search/issues').length).toBeLessThan(queries('/search/code').length * 2)
    expect(result.partial).toBe(true)
    expect(result.message).toMatch(/Only the \d+ most recently pushed repositories were searched/)
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
  it('batches GitHub repository search like issue search, not by the code query limit', async () => {
    const api = client()
    const repositories = Array.from({ length: 100 }, (_, index) => ({
      full_name: `simstudioai/repository-with-a-long-name-${index}`,
    }))
    api.json.mockImplementation(async (path) =>
      path === '/user/repos' ? repositories : { items: [], total_count: 0 }
    )
    await searchGitHub(api, {
      ...input,
      native: { provider: 'github', query: 'launch', kind: 'repositories' },
    })
    const searches = api.json.mock.calls.filter(([path]) => path === '/search/repositories')
    expect(searches.length).toBeGreaterThan(0)
    expect(searches.length).toBeLessThanOrEqual(2)
  })
  it('skips code search when the query leaves no room for a repository qualifier', async () => {
    const api = client()
    api.json.mockImplementation(async (path) =>
      path === '/user/repos' ? [{ full_name: 'org/repo' }] : { items: [], total_count: 0 }
    )
    const result = await searchGitHub(api, { ...input, query: `launch label:"${'x'.repeat(960)}"` })
    const searches = api.json.mock.calls.filter(([path]) => path.startsWith('/search/'))
    expect(searches.map(([path]) => path)).toEqual(['/search/issues', '/search/issues'])
    expect(result).toMatchObject({
      partial: true,
      message: expect.stringContaining('code search was skipped'),
    })
  })
  it('leaves a boolean GitHub query as written when dates are appended', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [], total_count: 0 })
    await searchGitHub(api, {
      ...input,
      native: {
        provider: 'github',
        query: 'repo:org/repo is:issue label:bug OR label:feature',
        kind: 'issues',
      },
      filters: { startDate: '2026-09-20T00:00:00Z' },
    })
    expect(api.json.mock.calls[0][1]?.query?.q).toBe(
      'repo:org/repo is:issue label:bug OR label:feature updated:>=2026-09-20T00:00:00.000Z'
    )
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
  it('lists dated GitHub issues without grouping an empty query', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [], total_count: 0 })
    await searchGitHub(api, {
      ...input,
      query: '',
      native: { provider: 'github', query: 'repo:org/repo is:issue', kind: 'issues' },
      filters: { startDate: '2026-09-20T00:00:00Z' },
    })
    expect(api.json.mock.calls[0][1]?.query?.q).toBe(
      'repo:org/repo is:issue updated:>=2026-09-20T00:00:00.000Z'
    )
  })
  it('searches GitHub commits by author date across affiliated repositories', async () => {
    const api = client()
    api.json.mockImplementation(async (path) =>
      path === '/user/repos'
        ? [{ full_name: 'org/repo' }]
        : {
            total_count: 1,
            items: [
              {
                sha: 'abc1234def',
                html_url: 'https://github.com/org/repo/commit/abc1234def',
                repository: { full_name: 'org/repo' },
                author: { login: 'octocat' },
                commit: {
                  message: 'fix: launch checklist\n\nDetails',
                  author: { name: 'Octo Cat', date: '2026-09-21T10:00:00.000-07:00' },
                },
              },
            ],
          }
    )
    const result = await searchGitHub(api, {
      ...input,
      query: '',
      native: { provider: 'github', query: 'author:@me', kind: 'commits' },
      filters: { startDate: '2026-09-16T00:00:00Z', sortBy: 'newest' },
    })
    const searches = api.json.mock.calls.filter(([path]) => path.startsWith('/search/'))
    expect(searches.map(([path, options]) => [path, options?.query])).toEqual([
      [
        '/search/commits',
        expect.objectContaining({
          q: 'author:@me repo:org/repo author-date:>=2026-09-16T00:00:00.000Z',
          sort: 'author-date',
          order: 'desc',
        }),
      ],
    ])
    expect(result.documents).toEqual([
      {
        id: 'abc1234def',
        container: 'org/repo',
        kind: 'commits',
        title: 'org/repo · fix: launch checklist',
        url: 'https://github.com/org/repo/commit/abc1234def',
        content: 'fix: launch checklist\n\nDetails',
        modifiedAt: '2026-09-21T17:00:00.000Z',
        author: 'octocat',
      },
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
  it('keeps the date range a native GitHub query already sets instead of ORing another', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [], total_count: 0 })
    await searchGitHub(api, {
      ...input,
      native: {
        provider: 'github',
        query: 'repo:org/repo author:@me author-date:>=2026-09-22',
        kind: 'commits',
      },
      filters: { startDate: '2026-09-16T00:00:00Z' },
    })
    expect(api.json.mock.calls[0][1]?.query?.q).toBe(
      'repo:org/repo author:@me author-date:>=2026-09-22'
    )
  })
  it('reads a GitHub commit with a bounded changed-file list', async () => {
    const api = client()
    api.json.mockResolvedValue({
      sha: 'abc1234def',
      html_url: 'https://github.com/org/repo/commit/abc1234def',
      author: null,
      commit: {
        message: 'fix: launch',
        author: { name: 'Octo Cat', date: '2026-09-21T17:00:00Z' },
      },
      files: [{ status: 'modified', filename: 'src/launch.ts', additions: 3, deletions: 1 }],
    })
    const document = await readGitHub(api, 'abc1234', 'org/repo', 'commits')
    expect(api.json).toHaveBeenCalledWith('/repos/org/repo/commits/abc1234', {
      query: { per_page: '30' },
    })
    expect(document).toMatchObject({
      id: 'abc1234def',
      container: 'org/repo',
      author: 'Octo Cat',
      content: 'fix: launch\n\nFiles changed:\nmodified src/launch.ts (+3 -1)',
    })
  })
  it.each(['main', '../abc1234', 'abc12'])('rejects the GitHub commit reference %s', async (id) => {
    const api = client()
    await expect(readGitHub(api, id, 'org/repo', 'commits')).rejects.toThrow(
      'Invalid GitHub commit reference'
    )
    expect(api.json).not.toHaveBeenCalled()
  })
  it('searches Atlassian sites in parallel and reads accessible sites once per client', async () => {
    const api = client()
    api.json.mockImplementation(async (path) => {
      if (path === '/oauth/token/accessible-resources')
        return [
          { id: 'one', url: 'https://one.atlassian.net' },
          { id: 'two', url: 'https://two.atlassian.net' },
        ]
      const site = path.includes('/one/') ? 'one' : 'two'
      return {
        results: [
          {
            content: { id: `${site}-1`, title: 'A' },
            excerpt: '@@@hl@@@Launch@@@endhl@@@ &amp; plan',
          },
          { content: { id: `${site}-2`, title: 'B' } },
        ],
      }
    })
    const session = withJsonMemo(api)
    const result = await searchAtlassian(session, 'confluence', input)
    await searchAtlassian(session, 'confluence', input)
    expect(result.documents.map((item) => item.id)).toEqual(['one-1', 'two-1', 'one-2', 'two-2'])
    expect(result.documents[0].content).toBe('Launch & plan')
    expect(
      api.json.mock.calls.filter(([path]) => path === '/oauth/token/accessible-resources')
    ).toHaveLength(1)
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
  it('reads a Slack reply directly without requiring it in channel history', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ text: 'Reply evidence', user: 'U1' }],
        has_more: true,
      })
      .mockResolvedValueOnce({ ok: true, permalink: 'https://team.slack.com/archives/C1/p123456' })
    const result = await readSlack(api, '123.456', 'C1')
    expect(api.json.mock.calls[0]).toEqual([
      '/api/conversations.replies',
      { query: { channel: 'C1', ts: '123.456', limit: '100' } },
    ])
    expect(result.content).toContain('Reply evidence')
    expect(result.content).toContain('Thread continues')
    expect(api.json).toHaveBeenCalledTimes(2)
  })
  it('applies Slack modifiers and date bounds without requiring term clauses', async () => {
    const api = client()
    api.json.mockResolvedValue({ ok: true, results: { messages: [] } })
    await searchSlack(api, {
      ...input,
      scopes: ['search:read.public'],
      native: { provider: 'slack', query: 'launch', modifiers: 'in:<#C123>' },
      filters: {
        startDate: '2026-09-22T07:00:00.500Z',
        endDate: '2026-09-23T07:00:00.500Z',
        sortBy: 'newest',
      },
    })
    expect(api.json.mock.calls[0]?.[1]?.body).toMatchObject({
      query: 'launch in:<#C123>',
      after: Math.floor(Date.parse('2026-09-22T07:00:00.500Z') / 1000) - 1,
      before: Math.ceil(Date.parse('2026-09-23T07:00:00.500Z') / 1000),
      sort: 'timestamp',
      sort_dir: 'desc',
    })
    expect(api.json.mock.calls[0]?.[1]?.body).not.toHaveProperty('term_clauses')
  })
  it('includes granted Slack files and surrounding message text', async () => {
    const api = client()
    api.json.mockResolvedValue({
      ok: true,
      results: {
        messages: [
          {
            message_ts: '123.456',
            content: 'Match',
            context_messages: { before: [{ text: 'Before' }] },
          },
        ],
        files: [{ file_id: 'F123', title: 'Budget', content: '42', date_updated: 1700000000 }],
      },
    })
    const result = await searchSlack(api, {
      ...input,
      scopes: ['search:read.public', 'search:read.files'],
    })
    expect(result.documents[0].content).toContain('Before')
    expect(result.documents[1]).toMatchObject({ id: 'F123', kind: 'file', content: '42' })
  })
  it('retains calendar results when a different calendar is inaccessible', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({ items: [{ id: 'primary' }, { id: 'denied' }] })
      .mockResolvedValueOnce({ items: [{ id: 'e', summary: 'Launch' }] })
      .mockRejectedValueOnce(new Error('denied'))
    expect(await searchCalendar(api, input)).toMatchObject({
      partial: true,
      documents: [{ id: 'e' }],
    })
  })
  it('retains GitHub issues when code search fails', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce([{ full_name: 'org/repo' }])
      .mockResolvedValueOnce({
        items: [
          { number: 1, title: 'Issue', repository_url: 'https://api.github.com/repos/org/repo' },
        ],
      })
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(new Error('code rate limit'))
    expect(await searchGitHub(api, input)).toMatchObject({
      partial: true,
      documents: [{ id: '1' }],
    })
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
  it('uses member-project search on GitLab without a global code-search backend', async () => {
    const api = client()
    api.json.mockImplementation(async (path) => (path === '/api/v4/projects' ? [{ id: 42 }] : []))
    await searchGitLab(api, input)
    expect(api.json).toHaveBeenCalledWith(
      '/api/v4/projects',
      expect.objectContaining({ query: expect.objectContaining({ membership: 'true' }) })
    )
    expect(
      api.json.mock.calls.filter(([path]) => path === '/api/v4/projects/42/search')
    ).toHaveLength(3)
    expect(api.json.mock.calls.some(([path]) => path === '/api/v4/search')).toBe(false)
  })
  it('reads GitLab merge request assignees from the deprecated single assignee', async () => {
    const api = client()
    const search = (row: Record<string, unknown>) => {
      api.json.mockResolvedValueOnce([
        {
          iid: 7,
          project_id: 4,
          web_url: 'https://gitlab.com/org/repo/-/merge_requests/7',
          ...row,
        },
      ])
      return searchGitLab(api, {
        ...input,
        native: { provider: 'gitlab', query: 'launch', kind: 'merge_requests', project: '4' },
      })
    }
    expect(await search({ assignee: { id: 3 } })).toMatchObject({
      documents: [{ accessMetadata: { assigneeIds: [3] } }],
    })
    expect(await search({})).toMatchObject({ documents: [{ accessMetadata: { assigneeIds: [] } }] })
  })
  it('binds GitLab code references and links to the searched revision', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce([
        { path: 'src/a.ts', ref: 'release', project_id: 4, data: 'Evidence' },
      ])
      .mockResolvedValueOnce({ web_url: 'https://gitlab.com/org/repo' })
    const result = await searchGitLab(api, {
      ...input,
      native: { provider: 'gitlab', query: 'Evidence', kind: 'code', project: '4' },
    })
    expect(result.documents[0]).toMatchObject({
      revision: 'release',
      url: 'https://gitlab.com/org/repo/-/blob/release/src/a.ts',
    })
    api.json
      .mockResolvedValueOnce({ web_url: 'https://gitlab.com/org/repo' })
      .mockResolvedValueOnce({ content: 'RXZpZGVuY2U=' })
    await readGitLab(api, 'src/a.ts', '4', 'code', 'release')
    expect(api.json).toHaveBeenLastCalledWith('/api/v4/projects/4/repository/files/src%2Fa.ts', {
      query: { ref: 'release' },
    })
  })
  it('labels Coda title-only coverage rather than claiming full-text search', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [{ id: 'd', name: 'Launch' }] })
    expect(await searchCoda(api, input)).toMatchObject({
      partial: true,
      message: expect.stringContaining('document titles'),
    })
  })
  it('never replaces missing Slack RTS consent with a bot or indexed lookup', async () => {
    const api = client()
    await expect(searchSlack(api, input)).rejects.toMatchObject({ status: 'reconnect' })
    expect(api.json).not.toHaveBeenCalled()
  })
  it('uses enhanced Jira search and leaves JQL intact', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce([{ id: 'site', url: 'https://team.atlassian.net' }])
      .mockResolvedValueOnce({
        issues: [
          {
            key: 'T-1',
            fields: {
              summary: 'Launch',
              description: { content: [{ type: 'paragraph', content: [{ text: 'Evidence' }] }] },
            },
          },
        ],
        nextPageToken: 'next',
      })
    const result = await searchAtlassian(api, 'jira', {
      ...input,
      native: { provider: 'jira', query: 'project = T AND updated > -7d', project: 'site' },
    })
    expect(api.json.mock.calls[1][0]).toBe('/ex/jira/site/rest/api/3/search/jql')
    expect(api.json.mock.calls[1][1]?.body).toMatchObject({ jql: 'project = T AND updated > -7d' })
    expect(result.documents[0].content).toContain('Evidence')
  })
  it('uses Confluence CQL search rather than inventing a v2 search API', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce([{ id: 'site', url: 'https://team.atlassian.net' }])
      .mockResolvedValueOnce({
        results: [
          {
            content: { id: '1', title: 'Launch', _links: { webui: '/spaces/X/pages/1' } },
            excerpt: 'Summary',
          },
        ],
        _links: { next: '/wiki/rest/api/search?cursor=abc' },
      })
    const result = await searchAtlassian(api, 'confluence', input)
    expect(api.json.mock.calls[1][0]).toBe('/ex/confluence/site/wiki/rest/api/search')
    expect(api.json.mock.calls[1][1]?.query?.cql).toBe(
      'type IN (page, blogpost) AND text ~ "launch"'
    )
    expect(result.nextCursor).toBe('abc')
  })
  it('reports GitHub incomplete results and the 1,000-result ceiling', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [], total_count: 1200, incomplete_results: true })
    const result = await searchGitHub(api, {
      ...input,
      native: { provider: 'github', query: 'repo:org/repo auth', kind: 'code' },
    })
    expect(result).toMatchObject({ partial: true, hasMore: true, nextCursor: '2' })
    expect(api.json.mock.calls[0][0]).toBe('/search/code')
  })
})
