/**
 * Pins the listing-completeness signals the sync engine relies on to decide whether it may
 * hard-delete stored documents, plus the Link-header cursor parsing Circleback pagination
 * depends on. `listingCapped` and a truthful `hasMore` are the only things standing between
 * a partial listing and reconciliation purging the rest of the knowledge base.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ CirclebackIcon: () => null }))

import { circlebackConnector } from '@/connectors/circleback/circleback'

function meeting(id: string) {
  return {
    id,
    name: `Meeting ${id}`,
    createdAt: '2026-01-27T15:30:00Z',
    updatedAt: '2026-01-27T16:45:00Z',
    duration: 1800,
    tags: [{ id: 1, name: 'Customer' }],
    attendees: [{ profileId: 1, name: 'Oat Benson', email: 'oat@example.com' }],
    notes: '## Recap\nWe discussed the rollout.',
    actionItems: [
      {
        id: 10,
        title: 'Send follow-up',
        description: '',
        assignee: { name: 'Oat Benson', email: 'oat@example.com' },
        status: 'PENDING',
      },
    ],
    insights: {},
  }
}

/** Queue a single Circleback list response with an optional RFC 8288 next link. */
function mockListResponse(body: unknown, nextCursor?: string, status = 200) {
  mockFetchWithRetry.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'link' && nextCursor
          ? `<https://circleback.ai/api/meetings?cursor=${nextCursor}>; rel="next"`
          : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

const list = (sourceConfig: Record<string, unknown>, syncContext: Record<string, unknown>) =>
  circlebackConnector.listDocuments('tok', sourceConfig, undefined, syncContext, undefined)

describe('circleback connector listing completeness', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('parses the next cursor from the Link header on a normal page', async () => {
    mockListResponse([meeting('m1')], 'cur_2')

    const syncContext: Record<string, unknown> = {}
    const page = await list({}, syncContext)

    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('cur_2')
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('reports a complete listing when there is no next link', async () => {
    mockListResponse([meeting('m1'), meeting('m2')])

    const syncContext: Record<string, unknown> = {}
    const page = await list({}, syncContext)

    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBeUndefined()
    expect(page.documents).toHaveLength(2)
  })

  it('never caps when no maxMeetings is configured', async () => {
    mockListResponse([meeting('m1'), meeting('m2')], 'cur_2')

    const syncContext: Record<string, unknown> = {}
    await list({ maxMeetings: '' }, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('caps and flags when maxMeetings slices a page, hiding meetings that still exist', async () => {
    mockListResponse([meeting('m1'), meeting('m2'), meeting('m3')])

    const syncContext: Record<string, unknown> = {}
    const page = await list({ maxMeetings: '2' }, syncContext)

    expect(page.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
    expect(page.hasMore).toBe(false)
  })

  it('caps and flags when maxMeetings lands on a page boundary but more pages exist', async () => {
    mockListResponse([meeting('m1'), meeting('m2')], 'cur_2')

    const syncContext: Record<string, unknown> = {}
    const page = await list({ maxMeetings: '2' }, syncContext)

    expect(page.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
    expect(page.hasMore).toBe(false)
  })

  it('does NOT flag when the cap lands exactly on the last meeting and the source is exhausted', async () => {
    mockListResponse([meeting('m1'), meeting('m2')])

    const syncContext: Record<string, unknown> = {}
    const page = await list({ maxMeetings: '2' }, syncContext)

    expect(page.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('carries the cap across pages via totalDocsFetched', async () => {
    mockListResponse([meeting('m3'), meeting('m4')], 'cur_3')

    const syncContext: Record<string, unknown> = { totalDocsFetched: 1 }
    const page = await list({ maxMeetings: '2' }, syncContext)

    expect(page.documents).toHaveLength(1)
    expect(syncContext.totalDocsFetched).toBe(2)
    expect(syncContext.listingCapped).toBe(true)
  })
})

describe('circleback connector request shaping and documents', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset()
  })

  it('applies only valid scope filters and defaults ownership to Mine', async () => {
    mockListResponse([])

    await list({ ownership: 'Everything', tagIds: '3, oops, 7' }, {})

    const url = new URL(mockFetchWithRetry.mock.calls[0][0] as string)
    expect(url.searchParams.get('ownership')).toBe('Mine')
    expect(url.searchParams.getAll('tagIds')).toEqual(['3', '7'])
  })

  it('returns deferred plain-text stubs with a metadata-based hash and source URL', async () => {
    mockListResponse([meeting('m1')])

    const page = await list({}, {})
    const stub = page.documents[0]

    expect(stub.mimeType).toBe('text/plain')
    expect(stub.contentDeferred).toBe(true)
    expect(stub.contentHash).toBe('circleback:m1:2026-01-27T16:45:00Z:notes')
    expect(stub.sourceUrl).toBe('https://circleback.ai/meetings/m1')
  })

  it('varies the content hash with the transcript mode so toggling it rehydrates', async () => {
    mockListResponse([meeting('m1')])
    const withTranscript = await list({ includeTranscript: 'true' }, {})
    expect(withTranscript.documents[0].contentHash).toBe(
      'circleback:m1:2026-01-27T16:45:00Z:transcript'
    )
  })

  it('assembles notes and action items into content with an identical hash on getDocument', async () => {
    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => meeting('m1'),
      text: async () => '',
    } as unknown as Response)

    const doc = await circlebackConnector.getDocument('tok', {}, 'm1')

    expect(doc).not.toBeNull()
    expect(doc?.contentDeferred).toBe(false)
    expect(doc?.contentHash).toBe('circleback:m1:2026-01-27T16:45:00Z:notes')
    expect(doc?.content).toContain('# Meeting m1')
    expect(doc?.content).toContain('We discussed the rollout.')
    expect(doc?.content).toContain('- [ ] Send follow-up (Oat Benson)')
    /* Transcript is opt-in, so only the meeting endpoint is called by default. */
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
  })

  it('returns null for a 404 but rethrows other failures so indexed documents survive', async () => {
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response)
    expect(await circlebackConnector.getDocument('tok', {}, 'gone')).toBeNull()

    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response)
    await expect(circlebackConnector.getDocument('tok', {}, 'm1')).rejects.toThrow('500')
  })

  it('rejects caps that the parser would silently treat as unlimited', async () => {
    for (const bad of ['0', '0.5', 'Infinity', '-1', 'abc']) {
      const result = await circlebackConnector.validateConfig('tok', { maxMeetings: bad })
      expect(result.valid).toBe(false)
    }

    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [],
      text: async () => '',
    } as unknown as Response)
    const ok = await circlebackConnector.validateConfig('tok', { maxMeetings: '25' })
    expect(ok.valid).toBe(true)
  })

  it('maps metadata to declared tag keys', () => {
    const tags = circlebackConnector.mapTags?.({
      title: 'Weekly Sync',
      attendees: ['Oat Benson', 'Sam Lee'],
      tags: ['Customer'],
      meetingDate: '2026-01-27T15:30:00Z',
      duration: 1800,
    })

    expect(tags?.title).toBe('Weekly Sync')
    expect(tags?.attendees).toBe('Oat Benson, Sam Lee')
    expect(tags?.tags).toBe('Customer')
    expect(tags?.meetingDate).toBeInstanceOf(Date)
    expect(tags?.duration).toBe(1800)
  })
})
