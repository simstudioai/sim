/**
 * Pins the Otter connector's listing-completeness and change-detection contracts. Otter has no
 * modification timestamp and reconciliation deletes whatever a complete listing omits, so a
 * malformed page must fail rather than shrink, and edits must still reach recent conversations.
 */
import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { otterConnector } from '@/connectors/otter/otter'

const mockFetchWithRetry = knowledgeSecureFetchMockFns.mockFetchWithRetry
const NOW = new Date('2026-09-28T12:00:00Z')

/** A conversation shaped like the documented `GET /conversations` item. */
function conversation(id: string, createdAt = '2026-09-27T10:00:00Z') {
  return {
    id,
    title: `Meeting ${id}`,
    url: `https://otter.ai/u/${id}`,
    owner: {
      id: 'u1',
      name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
    },
    created_at: createdAt,
    process_status: { abstract_summary: 'finished', action_item: 'finished', outline: 'finished' },
    calendar_guests: [{ name: 'John Doe', email: 'john@example.com' }],
    shared_emails: [],
    shared_channels: [],
    abstract_summary: 'Discussed the launch.',
    conf_join_url: null,
  }
}

function detail(id: string, createdAt: string, actionItem: string, transcript = 'Jane  00:00\nHi') {
  return {
    meta: { retrieved_at: '2026-09-28T12:00:00Z' },
    data: {
      ...conversation(id, createdAt),
      relationships: {
        action_items: [{ id: 'a1', text: actionItem, assignee: null, status: null }],
        insights: [],
        outline: [],
        transcript: { content: transcript, format: 'txt' },
      },
    },
  }
}

const respond = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

const list = (sourceConfig: Record<string, unknown> = {}, syncContext = {}) =>
  otterConnector.listDocuments('key', sourceConfig, undefined, syncContext)
const get = (id: string, sourceConfig: Record<string, unknown> = {}) =>
  otterConnector.getDocument('key', sourceConfig, id)
const match = (candidate: string, stored: string) =>
  otterConnector.matchContentHash!(candidate, stored)

describe('otter connector', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mockFetchWithRetry.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('listing completeness', () => {
    it('rejects a page containing a conversation without an ID', async () => {
      mockFetchWithRetry.mockResolvedValueOnce(
        respond({
          meta: { has_more: false },
          data: [conversation('c1'), { ...conversation('c2'), id: null }],
        })
      )
      await expect(list()).rejects.toThrow('conversation without an ID')
    })

    it('rejects a page whose has_more is not a boolean', async () => {
      mockFetchWithRetry.mockResolvedValueOnce(respond({ meta: {}, data: [conversation('c1')] }))
      await expect(list()).rejects.toThrow('missing meta.has_more')
    })

    it('marks the listing capped only when the cap hid conversations', async () => {
      mockFetchWithRetry.mockResolvedValueOnce(
        respond({
          meta: { has_more: true, next_cursor: 'n2' },
          data: [conversation('c1'), conversation('c2')],
        })
      )
      const capped: Record<string, unknown> = {}
      const page = await list({ maxConversations: '2' }, capped)
      expect(page.hasMore).toBe(false)
      expect(capped.listingCapped).toBe(true)

      mockFetchWithRetry.mockResolvedValueOnce(
        respond({ meta: { has_more: false }, data: [conversation('c1'), conversation('c2')] })
      )
      const exact: Record<string, unknown> = {}
      await list({ maxConversations: '2' }, exact)
      expect(exact.listingCapped).toBeUndefined()
    })
  })

  describe('change detection', () => {
    it('keeps an older conversation current until its metadata changes', async () => {
      const created = '2026-08-01T10:00:00Z'
      mockFetchWithRetry.mockResolvedValueOnce(
        respond({ meta: { has_more: false }, data: [conversation('old', created)] })
      )
      const [stub] = (await list()).documents
      mockFetchWithRetry.mockResolvedValueOnce(respond(detail('old', created, 'Send pricing')))
      const hydrated = await get('old')

      vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
      mockFetchWithRetry.mockResolvedValueOnce(
        respond({ meta: { has_more: false }, data: [conversation('old', created)] })
      )
      const [nextDay] = (await list()).documents

      expect(match(nextDay.contentHash, hydrated!.contentHash)).toBe('current')
      expect(nextDay.contentHash).toBe(stub.contentHash)
    })

    it('re-reads a recent conversation daily and re-indexes only changed text', async () => {
      const created = '2026-09-27T10:00:00Z'
      mockFetchWithRetry.mockResolvedValueOnce(respond(detail('new', created, 'Send pricing')))
      const stored = await get('new')

      vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
      mockFetchWithRetry.mockResolvedValueOnce(
        respond({ meta: { has_more: false }, data: [conversation('new', created)] })
      )
      const [nextDay] = (await list()).documents
      expect(match(nextDay.contentHash, stored!.contentHash)).toBe('stale')

      mockFetchWithRetry.mockResolvedValueOnce(respond(detail('new', created, 'Send pricing')))
      const unchanged = await get('new')
      expect(match(unchanged!.contentHash, stored!.contentHash)).toBe('equivalent')

      mockFetchWithRetry.mockResolvedValueOnce(respond(detail('new', created, 'Send pricing v2')))
      const edited = await get('new')
      expect(match(edited!.contentHash, stored!.contentHash)).toBe('stale')
    })
  })

  describe('hydration', () => {
    it('treats only a missing conversation as gone and rethrows transient failures', async () => {
      mockFetchWithRetry.mockResolvedValueOnce(respond({ error: 'not_found' }, 404))
      await expect(get('gone')).resolves.toBeNull()

      mockFetchWithRetry.mockResolvedValueOnce(respond({ error: 'rate_limited' }, 429))
      await expect(get('busy')).rejects.toThrow('429')
    })

    it('indexes the notes when the full response exceeds the download limit', async () => {
      const created = '2026-09-27T10:00:00Z'
      const oversized = detail('big', created, 'Send pricing', 'x'.repeat(17 * 1024 * 1024))
      mockFetchWithRetry
        .mockResolvedValueOnce(respond(oversized))
        .mockResolvedValueOnce(respond(detail('big', created, 'Send pricing', '')))

      const document = await get('big')

      expect(document?.skippedReason).toBeUndefined()
      expect(document?.content).toContain('Send pricing')
      expect(document?.content).toContain('Transcript omitted')
      expect(String(mockFetchWithRetry.mock.calls[1][0])).toContain(
        'include=action_items%2Cinsights%2Coutline'
      )
    })
  })
})
