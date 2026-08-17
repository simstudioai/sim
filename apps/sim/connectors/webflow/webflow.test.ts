/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isCurrentItem, webflowConnector } from '@/connectors/webflow/webflow'

describe('isCurrentItem', () => {
  it.concurrent('keeps items explicitly not archived', () => {
    expect(isCurrentItem({ isArchived: false })).toBe(true)
  })

  it.concurrent('excludes items explicitly archived', () => {
    expect(isCurrentItem({ isArchived: true })).toBe(false)
  })

  it.concurrent('keeps items with no archived flag', () => {
    expect(isCurrentItem({})).toBe(true)
  })

  it.concurrent('keeps items whose archived flag is undefined', () => {
    expect(isCurrentItem({ isArchived: undefined })).toBe(true)
  })

  it.concurrent('keeps drafts, which are unpublished but still present in the CMS', () => {
    expect(isCurrentItem({ isArchived: false, isDraft: true } as { isArchived?: boolean })).toBe(
      true
    )
  })

  it.concurrent('excludes archived drafts', () => {
    expect(isCurrentItem({ isArchived: true, isDraft: true } as { isArchived?: boolean })).toBe(
      false
    )
  })

  it.concurrent('keeps items when the flag is a non-boolean truthy value', () => {
    expect(isCurrentItem({ isArchived: 'true' } as unknown as { isArchived?: boolean })).toBe(true)
  })

  it.concurrent('filters only archived items out of a page listing', () => {
    const items = [
      { id: 'a', isArchived: false },
      { id: 'b', isArchived: true },
      { id: 'c' },
      { id: 'd', isDraft: true },
    ]
    expect(items.filter(isCurrentItem).map((i) => i.id)).toEqual(['a', 'c', 'd'])
  })
})

const ACCESS_TOKEN = 'test-token'
const CONFIG = { siteId: 'site-1', collectionId: 'col-1' }

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function itemFixture(id: string) {
  return { id, fieldData: { name: id, slug: id }, lastUpdated: '2026-01-01T00:00:00Z' }
}

/**
 * The collection-name lookup fires before the items request, so every listing
 * exercise queues that response first.
 */
function mockNameThenItems(itemsBody: unknown) {
  mockFetch
    .mockResolvedValueOnce(jsonResponse({ id: 'col-1', displayName: 'Posts' }))
    .mockResolvedValueOnce(jsonResponse(itemsBody))
}

describe('webflow listDocuments deletion-reconciliation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves listingCapped unset when the cap lands exactly on collection exhaustion', async () => {
    mockNameThenItems({ items: [itemFixture('a')], pagination: { total: 1 } })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxItems: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when the cap stops short of the collection total', async () => {
    mockNameThenItems({ items: [itemFixture('a')], pagination: { total: 10 } })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxItems: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  /**
   * Without a usable `pagination.total` the offset math cannot tell a full page
   * apart from the last one, so treating it as exhausted would feed every unread
   * row to deletion reconciliation.
   */
  it('flags listingCapped on a full page whose envelope carries no usable total', async () => {
    const items = Array.from({ length: 100 }, (_, i) => itemFixture(`item-${i}`))
    mockNameThenItems({ items })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset on a short page with no usable total', async () => {
    mockNameThenItems({ items: [itemFixture('a')] })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
  })
})
