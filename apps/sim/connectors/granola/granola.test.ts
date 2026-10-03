/**
 * Pins the listing-completeness signals the sync engine relies on to decide whether it may
 * hard-delete stored documents. `listingCapped` and a truthful `hasMore` are the only things
 * standing between a partial listing and reconciliation purging the rest of the knowledge base,
 * so each quadrant is asserted explicitly.
 */
import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { granolaConnector } from '@/connectors/granola/granola'

const mockFetchWithRetry = knowledgeSecureFetchMockFns.mockFetchWithRetry

function note(id: string) {
  return {
    id,
    object: 'note',
    title: `Note ${id}`,
    owner: { name: 'Oat Benson', email: 'oat@granola.ai' },
    created_at: '2026-01-27T15:30:00Z',
    updated_at: '2026-01-27T16:45:00Z',
  }
}

/** Queue a single Granola list-notes response. */
function mockListResponse(body: unknown, status = 200) {
  mockFetchWithRetry.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

const list = (sourceConfig: Record<string, unknown>, syncContext: Record<string, unknown>) =>
  granolaConnector.listDocuments('tok', sourceConfig, undefined, syncContext, undefined)

describe('granola connector listing completeness', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('surfaces hasMore=true with no cursor so the engine can mark the listing truncated', async () => {
    /**
     * The engine sets `listingTruncated` (which blocks deletion reconciliation outright) only when
     * a connector reports this shape. Collapsing it to hasMore=false would present a partial page
     * as the complete corpus.
     */
    mockListResponse({ notes: [note('not_1')], hasMore: true, cursor: null })

    const page = await list({}, {})

    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBeUndefined()
  })

  it('caps and flags when maxNotes slices a page, hiding notes that still exist', async () => {
    mockListResponse({
      notes: [note('not_1'), note('not_2'), note('not_3')],
      hasMore: false,
      cursor: null,
    })

    const syncContext: Record<string, unknown> = {}
    const page = await list({ maxNotes: '2' }, syncContext)

    expect(page.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
    expect(page.hasMore).toBe(false)
  })

  it('caps and flags when maxNotes lands on a page boundary but more pages exist', async () => {
    mockListResponse({ notes: [note('not_1'), note('not_2')], hasMore: true, cursor: 'cur_2' })

    const syncContext: Record<string, unknown> = {}
    const page = await list({ maxNotes: '2' }, syncContext)

    expect(page.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
    expect(page.hasMore).toBe(false)
  })

  it('does NOT flag when the cap lands exactly on the last note and the source is exhausted', async () => {
    /**
     * Flagging here would block deletion reconciliation on every ordinary sync, stranding notes
     * deleted in Granola in the knowledge base indefinitely.
     */
    mockListResponse({ notes: [note('not_1'), note('not_2')], hasMore: false, cursor: null })

    const syncContext: Record<string, unknown> = {}
    const page = await list({ maxNotes: '2' }, syncContext)

    expect(page.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('carries the cap across pages via totalDocsFetched', async () => {
    mockListResponse({ notes: [note('not_3'), note('not_4')], hasMore: true, cursor: 'cur_3' })

    const syncContext: Record<string, unknown> = { totalDocsFetched: 1 }
    const page = await list({ maxNotes: '2' }, syncContext)

    expect(page.documents).toHaveLength(1)
    expect(syncContext.totalDocsFetched).toBe(2)
    expect(syncContext.listingCapped).toBe(true)
  })
})
