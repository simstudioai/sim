/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ GmailIcon: () => null }))

import { gmailConnector } from '@/connectors/gmail/gmail'

function threads(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, historyId: '1' }))
}

/** Queues thread-list pages in order; each call records the requested URL. */
function mockPages(pages: { threads: unknown[]; nextPageToken?: string }[]) {
  const urls: string[] = []
  let call = 0
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    urls.push(url)
    const page = pages[call++] ?? { threads: [] }
    return {
      ok: true,
      status: 200,
      json: async () => page,
      text: async () => JSON.stringify(page),
    } as unknown as Response
  })
  return urls
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('gmail listDocuments with maxThreads 0 (unlimited, a per-member sync)', () => {
  it('pages past a full page and never marks the listing capped', async () => {
    const urls = mockPages([
      { threads: threads(100, 'a'), nextPageToken: 'page-2' },
      { threads: threads(50, 'b') },
    ])
    const syncContext: Record<string, unknown> = {}

    const first = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 0 },
      undefined,
      syncContext
    )
    expect(first.documents).toHaveLength(100)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe('page-2')
    expect(syncContext.listingCapped).toBeUndefined()

    const second = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 0 },
      first.nextCursor,
      syncContext
    )
    expect(second.documents).toHaveLength(50)
    expect(second.hasMore).toBe(false)
    expect(syncContext.totalThreadsFetched).toBe(150)
    expect(syncContext.listingCapped).toBeUndefined()
    expect(urls[1]).toContain('pageToken=page-2')
    expect(urls[1]).toContain('maxResults=100')
  })

  it('still stops and flags a cap that truncates a longer listing', async () => {
    mockPages([{ threads: threads(100, 'a'), nextPageToken: 'page-2' }])
    const syncContext: Record<string, unknown> = {}

    const result = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 100 },
      undefined,
      syncContext
    )
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBe(true)
  })
})
