/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { searchAtlassian } from '@/lib/sim-search/live/atlassian'
import { searchCoda } from '@/lib/sim-search/live/coda'
import { searchGitHub } from '@/lib/sim-search/live/github'
import { readGitLab, searchGitLab } from '@/lib/sim-search/live/gitlab'
import { readDrive, searchCalendar, searchDrive, searchGmail } from '@/lib/sim-search/live/google'
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
      .mockResolvedValue({
        items: [{ id: 'e', summary: 'Launch', htmlLink: 'https://calendar.google.com/event' }],
      })
    const result = await searchCalendar(api, input)
    expect(result.documents.map((item) => item.container)).toEqual(['primary', 'team@example.com'])
    expect(api.json.mock.calls[2][0]).toContain('team%40example.com')
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
    expect(result).toMatchObject({ partial: true, nextCursor: '2' })
    expect(api.json.mock.calls[0][0]).toBe('/search/code')
  })
})
