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

  it('leaves listingCapped unset when a well-formed page exhausts the collection', async () => {
    mockNameThenItems({ items: [itemFixture('a'), itemFixture('b')], pagination: { total: 2 } })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when a well-formed page reports an empty collection', async () => {
    mockNameThenItems({ items: [], pagination: { total: 0 } })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
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

  /**
   * A short page is the same unknowable state as a full one: the fallback total
   * collapses to the rows in hand, so the collection ends here whether or not
   * rows remain. `total` is documented optional, so its absence proves nothing
   * either way — and "we cannot rule out unread rows" is the fail-safe reading.
   */
  it('flags listingCapped on a short page whose envelope carries no usable total', async () => {
    mockNameThenItems({ items: [itemFixture('a')] })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when the envelope has no pagination object at all', async () => {
    mockNameThenItems({ items: [itemFixture('a'), itemFixture('b')] })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })

  /**
   * `Number(null)`, `Number('')`, `Number([])`, and `Number(false)` are all a
   * finite `0`, so coercing the reported total reads a malformed envelope as
   * "this collection holds zero rows" — the listing reports itself complete
   * while holding rows, and reconciliation deletes every one of them.
   */
  it.each([
    ['null', null],
    ['an empty string', ''],
    ['an empty array', []],
    ['false', false],
    ['a negative count', -1],
    ['a fractional count', 2.5],
    ['a numeric string', '2'],
  ])('flags listingCapped when pagination.total is %s', async (_label, total) => {
    mockNameThenItems({ items: [itemFixture('a'), itemFixture('b')], pagination: { total } })

    const syncContext: Record<string, unknown> = {}
    const result = await webflowConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when pagination is present but carries no usable total', async () => {
    mockNameThenItems({ items: [itemFixture('a')], pagination: { limit: 100, offset: 0 } })

    const syncContext: Record<string, unknown> = {}
    await webflowConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })

  /**
   * The production shape: a malformed 200 empties a mid-list collection, the
   * walk advances to the next collection, and the whole run is reported as a
   * clean full listing. The skipped collection's documents are neither empty
   * nor below the collapse ratio, so no sync-engine backstop catches it.
   */
  it('flags listingCapped on an empty page with no pagination and still advances', async () => {
    mockNameThenItems({ items: [] })

    const syncContext: Record<string, unknown> = {}
    const result = await webflowConnector.listDocuments(
      ACCESS_TOKEN,
      { siteId: 'site-1', collectionId: 'col-1,col-2' },
      undefined,
      syncContext
    )

    expect(result.documents).toEqual([])
    expect(syncContext.listingCapped).toBe(true)
    expect(result.hasMore).toBe(true)
  })
})

/**
 * With no collection ids configured the run's whole scope comes from
 * `GET /sites/{id}/collections`.
 */
describe('webflow collection-scope resolution', () => {
  const SITE_ONLY = { siteId: 'site-1' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * An empty scope lists nothing without claiming truncation: `listedCount = 0`
   * is exactly the shape the sync engine's own `'empty'` backstop classifies as
   * suspect and blocks on the first sync, which still reconciles once a
   * consecutive sync corroborates it. Setting `listingCapped` here would
   * short-circuit that two-strike path and block reconciliation forever.
   */
  it.each([
    ['the envelope carries no collections key', {}],
    ['collections is null', { collections: null }],
    ['collections is empty', { collections: [] }],
  ])('lists nothing without flagging listingCapped when %s', async (_label, body) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(body))

    const syncContext: Record<string, unknown> = {}
    const result = await webflowConnector.listDocuments(
      ACCESS_TOKEN,
      SITE_ONLY,
      undefined,
      syncContext
    )

    expect(result.documents).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  /**
   * A non-array `collections` fails the sync loudly rather than syncing an empty
   * scope. The rejection is pinned to a `TypeError` — the spec-mandated failure
   * for a `for...of` over a non-iterable — rather than to the engine's wording,
   * and to the point of failure: the collection listing is the only request made
   * and nothing is written back to the sync context.
   */
  it('throws when collections is not an array', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ collections: { id: 'col-1' } }))

    const syncContext: Record<string, unknown> = {}
    await expect(
      webflowConnector.listDocuments(ACCESS_TOKEN, SITE_ONLY, undefined, syncContext)
    ).rejects.toThrow(TypeError)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(syncContext.collectionNames).toBeUndefined()
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when the site listing and its page are both well formed', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ collections: [{ id: 'col-1', displayName: 'Posts' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [itemFixture('a')], pagination: { total: 1 } }))

    const syncContext: Record<string, unknown> = {}
    const result = await webflowConnector.listDocuments(
      ACCESS_TOKEN,
      SITE_ONLY,
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })
})
