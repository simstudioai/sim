/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { searchWorkspaceInputSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { searchAtlassian } from '@/lib/sim-search/live/atlassian'
import { searchCoda } from '@/lib/sim-search/live/coda'
import { matchesSourceDates, sourceDate, sourceDateType } from '@/lib/sim-search/live/dates'
import { searchGitHub } from '@/lib/sim-search/live/github'
import { searchGitLab } from '@/lib/sim-search/live/gitlab'
import { searchCalendar, searchDrive, searchGmail } from '@/lib/sim-search/live/google'
import { readNativeProvider } from '@/lib/sim-search/live/providers'
import { readSlack, searchSlack } from '@/lib/sim-search/live/slack'
import type { NativeDocument, NativeSearchInput } from '@/lib/sim-search/live/types'

const filters = {
  startDate: '2026-09-22T00:00:00-07:00',
  endDate: '2026-09-23T00:00:00-07:00',
  sortBy: 'oldest' as const,
}
const input: NativeSearchInput = { query: '', limit: 20, scopes: ['search:read.public'], filters }
const client = () => ({ json: vi.fn(), text: vi.fn() })
const doc: NativeDocument = {
  id: 'one',
  title: 'Meeting',
  url: '',
  content: '',
  modifiedAt: '2026-01-01T00:00:00Z',
  eventStartAt: '2026-09-22T07:00:00Z',
}

describe('generic live search dates', () => {
  it('accepts a date-only request and rejects invalid or unbounded listings', () => {
    expect(searchWorkspaceInputSchema.parse(filters)).toMatchObject({
      ...filters,
      query: '',
      topK: 20,
    })
    for (const value of [
      {},
      { query: '' },
      { sortBy: 'oldest' },
      { startDate: 'today' },
      { ...filters, endDate: filters.startDate },
      { ...filters, endDate: '2026-09-21T00:00:00Z' },
    ])
      expect(searchWorkspaceInputSchema.safeParse(value).success).toBe(false)
    expect(
      searchWorkspaceInputSchema.safeParse({
        ...filters,
        nativeQueries: [{ provider: 'google_calendar', query: '', project: 'primary' }],
      }).success
    ).toBe(true)
  })
  it('keeps scheduled dates separate from edits and uses an exclusive upper bound', () => {
    expect(sourceDate(doc, 'google_calendar')).toBe(doc.eventStartAt)
    expect(sourceDate(doc, 'google_drive')).toBe(doc.modifiedAt)
    expect(matchesSourceDates(doc, 'google_calendar', filters)).toBe(true)
    expect(matchesSourceDates(doc, 'google_drive', filters)).toBe(false)
    expect(
      matchesSourceDates(
        { ...doc, eventStartAt: '2026-09-23T07:00:00Z' },
        'google_calendar',
        filters
      )
    ).toBe(false)
    expect(matchesSourceDates({ ...doc, modifiedAt: undefined }, 'github', filters)).toBe(false)
    expect(sourceDate({ ...doc, modifiedAt: 'invalid' }, 'github')).toBeUndefined()
    expect(sourceDateType('slack', { ...doc, kind: 'file' })).toBe('modified')
    expect(sourceDateType('slack', doc)).toBe('message')
  })
  it('intersects user-selected date constraints across offsets without widening them', () => {
    expect(
      intersectWorkspaceSearchFilters(
        { startDate: '2026-09-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z', sortBy: 'oldest' },
        filters
      )
    ).toEqual(filters)
    expect(() =>
      intersectWorkspaceSearchFilters({ startDate: '2026-10-01T00:00:00Z' }, filters)
    ).toThrow('outside this search')
  })
  it('passes Calendar bounds and recurring expansion with no extra search requests', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({ items: [{ id: 'primary', timeZone: 'America/Los_Angeles' }] })
      .mockResolvedValueOnce({
        timeZone: 'America/Los_Angeles',
        items: [
          {
            id: 'all-day',
            summary: 'Holiday',
            start: { date: '2026-09-22' },
            updated: '2026-01-01T00:00:00Z',
          },
          { id: 'recurring-instance', start: { dateTime: '2026-09-22T09:00:00-07:00' } },
        ],
      })
    const result = await searchCalendar(api, input)
    expect(api.json).toHaveBeenCalledTimes(2)
    expect(api.json.mock.calls[1]?.[1].query).toEqual(
      expect.objectContaining({
        timeMin: '2026-09-22T06:59:59.000Z',
        timeMax: '2026-09-23T07:00:00.000Z',
        singleEvents: 'true',
        orderBy: 'startTime',
      })
    )
    expect(api.json.mock.calls[1]?.[1].query).not.toHaveProperty('q')
    expect(result.documents[0]).toMatchObject({
      eventStartAt: '2026-09-22T07:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.documents[1]?.eventStartAt).toBe('2026-09-22T09:00:00-07:00')
  })
  it('widens Calendar native second precision and checks exact start instants locally', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [] })
    await searchCalendar(api, {
      ...input,
      filters: { startDate: '2026-09-22T07:00:00.500Z', endDate: '2026-09-22T07:00:01.500Z' },
      native: { provider: 'google_calendar', query: '', project: 'primary' },
    })
    expect(api.json.mock.calls[0]?.[1].query).toMatchObject({
      timeMin: '2026-09-22T06:59:59.000Z',
      timeMax: '2026-09-22T07:00:02.000Z',
    })
    expect(
      matchesSourceDates({ ...doc, eventStartAt: '2026-09-22T07:00:00.499Z' }, 'google_calendar', {
        startDate: '2026-09-22T07:00:00.500Z',
      })
    ).toBe(false)
  })
  it('converts all-day event dates using the calendar zone across DST', async () => {
    const api = client()
    api.json.mockResolvedValue({
      timeZone: 'America/Los_Angeles',
      items: [{ id: 'all-day', start: { date: '2026-11-01' } }],
    })
    const result = await searchCalendar(api, {
      ...input,
      native: { provider: 'google_calendar', query: '', project: 'primary' },
    })
    expect(result.documents[0]?.eventStartAt).toBe('2026-11-01T07:00:00.000Z')
    expect(api.json).toHaveBeenCalledTimes(1)
  })
  it('fetches the all-day Calendar timezone only for scheduled-date read enforcement', async () => {
    const api = client()
    const event = { id: 'holiday', start: { date: '2026-09-22' } }
    const reference = { id: 'holiday', container: 'primary' }
    api.json.mockResolvedValueOnce(event)
    await readNativeProvider('google_calendar', api, reference)
    expect(api.json).toHaveBeenCalledTimes(1)
    api.json.mockResolvedValueOnce(event).mockResolvedValueOnce({ timeZone: 'America/Los_Angeles' })
    const result = await readNativeProvider('google_calendar', api, reference, undefined, filters)
    expect(result.eventStartAt).toBe('2026-09-22T07:00:00.000Z')
    expect(api.json).toHaveBeenCalledTimes(3)
  })
  it('omits empty Coda title text for a bounded listing without enrichment', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [] })
    await searchCoda(api, input)
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(api.json.mock.calls[0]?.[1].query).not.toHaveProperty('query')
  })
  it('pushes Drive dates and ordering without reading file contents', async () => {
    const api = client()
    api.json.mockResolvedValue({ files: [] })
    await searchDrive(api, input)
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(api.text).not.toHaveBeenCalled()
    expect(api.json.mock.calls[0]?.[1].query).toMatchObject({
      q: expect.stringContaining("modifiedTime >= '2026-09-22T07:00:00.000Z'"),
      orderBy: 'modifiedTime',
    })
  })
  it('pushes Gmail second-based bounds and retains its existing metadata budget', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce({ messages: [{ id: 'mail' }] })
      .mockResolvedValueOnce({ id: 'mail', internalDate: String(Date.parse(filters.startDate)) })
    const result = await searchGmail(api, input)
    expect(api.json).toHaveBeenCalledTimes(2)
    expect(api.json.mock.calls[0]?.[1].query.q).toBe(
      `after:${Date.parse(filters.startDate) / 1000 - 1} before:${Date.parse(filters.endDate) / 1000 + 1}`
    )
    expect(matchesSourceDates(result.documents[0]!, 'gmail', filters)).toBe(true)
  })
  it('uses Slack date modifiers and preserves the matched reply when its root is older', async () => {
    const api = client()
    api.json.mockResolvedValueOnce({
      ok: true,
      results: {
        messages: [
          {
            message_ts: '1790060400.000001',
            thread_ts: '1789974000.000001',
            channel_id: 'C123',
            content: 'reply',
          },
        ],
      },
    })
    const result = await searchSlack(api, input)
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(api.json.mock.calls[0]?.[1].body).toMatchObject({
      modifiers: 'after:2026-09-21 before:2026-09-24',
      disable_semantic_search: true,
    })
    expect(result.documents[0]).toMatchObject({
      id: '1790060400.000001',
      threadId: '1789974000.000001',
    })
    api.json
      .mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: '1790060400.000001', text: 'reply' }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        permalink: 'https://workspace.slack.com/archives/C123/p1790060400000001',
      })
    const read = await readSlack(api, '1790060400.000001', 'C123', undefined, '1789974000.000001')
    expect(api.json.mock.calls[1]?.[1].query).toMatchObject({
      ts: '1789974000.000001',
      oldest: '1790060400.000001',
      inclusive: 'true',
    })
    expect(read.modifiedAt).toBe(result.documents[0]?.modifiedAt)
    expect(read.content).toContain('Thread continues')
    expect(api.json).toHaveBeenCalledTimes(3)
  })
  it('uses GitHub update qualifiers and avoids unsupported code-date requests', async () => {
    const api = client()
    api.json.mockResolvedValue({ items: [], total_count: 0 })
    await searchGitHub(api, {
      ...input,
      native: { provider: 'github', query: 'repo:team/repo is:pr', kind: 'issues' },
    })
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(api.json.mock.calls[0]?.[1].query).toMatchObject({
      q: expect.stringContaining('updated:>=2026-09-22T07:00:00.000Z'),
      sort: 'updated',
      order: 'asc',
    })
    await expect(
      searchGitHub(api, {
        ...input,
        native: { provider: 'github', query: 'repo:team/repo', kind: 'code' },
      })
    ).rejects.toThrow('modification dates')
    expect(api.json).toHaveBeenCalledTimes(1)
  })
  it('uses the configured GitLab project listing endpoint for dated issues', async () => {
    const api = client()
    api.json.mockResolvedValue([])
    await searchGitLab(api, {
      ...input,
      native: { provider: 'gitlab', query: '', project: '42', kind: 'issues' },
    })
    expect(api.json).toHaveBeenCalledExactlyOnceWith('/api/v4/projects/42/issues', {
      query: {
        scope: 'all',
        updated_after: '2026-09-22T07:00:00.000Z',
        updated_before: '2026-09-23T07:00:00.000Z',
        order_by: 'updated_at',
        sort: 'asc',
        per_page: '20',
        page: '1',
      },
    })
  })
  it('composes Atlassian dates with OR clauses and overrides only the final sort', async () => {
    const api = client()
    api.json
      .mockResolvedValueOnce([{ id: 'cloud', url: 'https://team.atlassian.net' }])
      .mockResolvedValueOnce({ issues: [] })
    await searchAtlassian(api, 'jira', {
      ...input,
      native: {
        provider: 'jira',
        query: 'summary ~ "order by" OR project = TEAM ORDER BY created DESC',
      },
    })
    expect(api.json).toHaveBeenCalledTimes(2)
    expect(api.json.mock.calls[1]?.[1].body.jql).toBe(
      '(summary ~ "order by" OR project = TEAM) AND updated >= "2026-09-21" AND updated <= "2026-09-24" ORDER BY updated ASC'
    )
  })
})
