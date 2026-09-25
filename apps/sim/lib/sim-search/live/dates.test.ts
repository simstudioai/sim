import { describe, expect, it, vi } from 'vitest'
import { searchWorkspaceInputSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { matchesSourceDates, sourceDate, sourceDateType } from '@/lib/sim-search/live/dates'
import { searchCalendar } from '@/lib/sim-search/live/google'
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
      { sortBy: 'relevance' },
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
  it('uses Slack timestamp bounds and preserves the matched reply when its root is older', async () => {
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
      after: Date.parse(filters.startDate) / 1000 - 1,
      before: Date.parse(filters.endDate) / 1000,
      sort: 'timestamp',
      sort_dir: 'asc',
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
})
