/**
 * The load-bearing logic here is the repository tree walk: a `max_depth` listing
 * that Bitbucket may answer with a `555` timeout, an opaque `next` cursor that
 * cannot be re-cut, and a per-run frontier of directories the walk has not reached.
 * Every path that shortens the listing has to leave `syncContext.listingCapped` set,
 * because the sync engine hard-deletes whatever a full listing omits.
 */
import { jsonResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bitbucketConnector } from '@/connectors/bitbucket/bitbucket'

const ACCESS_TOKEN = 'bitbucket-token'
const COMMIT = 'e7d158ff7ed5538c28f94cd97a9ad569680fc94e'
const CONFIG = { workspaceSlug: 'acme', repoSlug: 'widgets' }
const PR_CONFIG = { ...CONFIG, contentTypes: 'pullrequests' }

const mockFetch = vi.fn()

const REPOSITORY = {
  full_name: 'acme/widgets',
  mainbranch: { name: 'main', target: { hash: COMMIT } },
  links: { html: { href: 'https://bitbucket.org/acme/widgets' } },
}

function fileEntry(path: string, size = 10, attributes: string[] = []) {
  return {
    type: 'commit_file',
    path,
    size,
    attributes,
    commit: { hash: COMMIT },
  }
}

function dirEntry(path: string) {
  return { type: 'commit_directory', path, commit: { hash: COMMIT } }
}

function _pullRequestFixture(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `PR ${id}`,
    state: 'OPEN',
    summary: {
      raw: `Body of ${id}`,
      markup: 'markdown',
      html: `<p>Body of ${id}</p>`,
    },
    author: { display_name: 'Ada Lovelace', nickname: 'ada' },
    created_on: '2026-01-01T00:00:00.000000+00:00',
    updated_on: '2026-02-01T00:00:00.000000+00:00',
    links: {
      html: { href: `https://bitbucket.org/acme/widgets/pull-requests/${id}` },
    },
    ...overrides,
  }
}

/** Routes by URL, because the number of lookups before a listing varies by phase. */
function mockApi(routes: Array<[RegExp, () => Response]>) {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [pattern, respond] of routes) {
      if (pattern.test(url)) return respond()
    }
    if (/\/repositories\/acme\/widgets$/.test(url)) return jsonResponse(REPOSITORY)
    throw new Error(`unrouted request: ${url}`)
  })
}

function requestedUrls(pattern: RegExp): string[] {
  return mockFetch.mock.calls.map(([url]) => url as string).filter((url) => pattern.test(url))
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

describe('bitbucket repository file listing', () => {
  it('queues only the frontier directories the walk actually stopped at', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [dirEntry('a'), dirEntry('a/b'), dirEntry('a/b/c/d/e'), fileEntry('a/b/x.md')],
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    await bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.pendingDirs).toEqual(['a/b/c/d/e'])
  })

  it('walks the frontier on a following page and finishes without flagging the listing', async () => {
    mockApi([
      [
        /\/src\/[a-f0-9]+\/\?/,
        () =>
          jsonResponse({
            values: [dirEntry('a/b/c/d/e'), fileEntry('root.md')],
          }),
      ],
      [
        /\/src\/[a-f0-9]+\/a\/b\/c\/d\/e\/\?/,
        () => jsonResponse({ values: [fileEntry('a/b/c/d/e/deep.md')] }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)

    const second = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      first.nextCursor,
      syncContext
    )

    expect(second.documents.map((d) => d.externalId)).toEqual(['file:a/b/c/d/e/deep.md'])
    expect(second.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('rejects a next cursor that does not point at the Bitbucket Cloud API', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [],
            next: 'https://evil.example.com/2.0/repositories/x',
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    await expect(
      bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, first.nextCursor, syncContext)
    ).rejects.toThrow(/Bitbucket Cloud API/)
  })

  it('rejects a next cursor for another Bitbucket repository', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [],
            next: `https://api.bitbucket.org/2.0/repositories/other/repo/src/${COMMIT}/?page=2`,
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    await expect(
      bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, first.nextCursor, syncContext)
    ).rejects.toThrow(/does not belong/)
  })

  it('blocks reconciliation when a source entry lacks its documented path', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [{ type: 'commit_file' }] })]])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(result.documents).toEqual([])
    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.listingTruncated).toBe(true)
  })
})

describe('bitbucket source listing timeouts', () => {
  it('retries a first-page 555 at depth 1 and keeps the listing reconcilable', async () => {
    mockApi([
      [/max_depth=1/, () => jsonResponse({ values: [dirEntry('a'), fileEntry('root.md')] })],
      [/max_depth=5/, () => new Response('timeout', { status: 555 })],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['file:root.md'])
    expect(syncContext.listingCapped).toBeUndefined()
    /** The depth-1 response only reached one level, so `a` is now unexplored. */
    expect(syncContext.pendingDirs).toEqual(['a'])
    expect(result.hasMore).toBe(true)
  })

  it('flags the listing capped when a replayed next cursor times out, without re-cutting it', async () => {
    const nextUrl = `https://api.bitbucket.org/2.0/repositories/acme/widgets/src/${COMMIT}/?page=2&max_depth=5`
    mockApi([
      [/page=2/, () => new Response('timeout', { status: 555 })],
      [/\/src\//, () => jsonResponse({ values: [fileEntry('first.md')], next: nextUrl })],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )
    const second = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      first.nextCursor,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.listingTruncated).toBe(true)
    expect(second.documents).toEqual([])
    /** Exactly one attempt: an opaque cursor is never rebuilt at another depth. */
    expect(requestedUrls(/page=2/)).toHaveLength(1)
  })
})

describe('bitbucket maxItems cap', () => {
  it('flags the listing capped when the cap truncates a page', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [fileEntry('a.md'), fileEntry('b.md'), fileEntry('c.md')],
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxItems: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves the listing reconcilable when a complete listing ends exactly on the cap', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [fileEntry('a.md'), fileEntry('b.md')] })]])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxItems: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('lets an oversized file ride along without consuming the cap', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [fileEntry('huge.md', 500 * 1024 * 1024), fileEntry('a.md'), fileEntry('b.md')],
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxItems: '2' },
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual([
      'file:huge.md',
      'file:a.md',
      'file:b.md',
    ])
    expect(result.documents[0].skippedReason).toMatch(/size limit/)
  })
})

describe('bitbucket listing scope', () => {
  it.each([403, 404])(
    'reports a repository the token cannot reach (%i) as an unavailable listing scope',
    async (status) => {
      mockApi([[/\/repositories\/acme\/widgets$/, () => jsonResponse({ type: 'error' }, status)]])

      const error = await bitbucketConnector
        .listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})
        .catch((caught: unknown) => caught)

      expect(bitbucketConnector.isListingScopeUnavailableError?.(error)).toBe(true)
    }
  )

  it('keeps any other repository failure retryable', async () => {
    mockApi([[/\/repositories\/acme\/widgets$/, () => jsonResponse({ type: 'error' }, 500)]])

    const error = await bitbucketConnector
      .listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(bitbucketConnector.isListingScopeUnavailableError?.(error)).toBe(false)
  })
})

describe('bitbucket pull request listing', () => {
  it('renders the incremental BBQL filter with an explicit numeric UTC offset', async () => {
    mockApi([[/\/pullrequests/, () => jsonResponse({ values: [] })]])

    await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      PR_CONFIG,
      undefined,
      {},
      new Date('2026-02-03T04:05:06.007Z')
    )

    const url = new URL(requestedUrls(/\/pullrequests/)[0])
    expect(url.searchParams.get('q')).toBe('updated_on > 2026-02-03T04:05:06.007+00:00')
  })
})

describe('bitbucket getDocument', () => {
  it('surfaces an LFS-managed file as skipped rather than following the media redirect', async () => {
    mockApi([
      [
        /\/src\/[a-f0-9]+\/big\.bin$/,
        () =>
          new Response(null, {
            status: 301,
            headers: { Location: 'https://media.atlassian.com/file/abc' },
          }),
      ],
    ])

    const doc = await bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'file:big.bin', {})

    expect(doc?.skippedReason).toMatch(/LFS/)
    expect(doc?.content).toBe('')
  })

  it('decodes non-UTF-8 source as Windows-1252 instead of skipping or indexing replacement characters', async () => {
    mockApi([
      [
        /\/src\/[a-f0-9]+\/latin1\.txt$/,
        () => new Response(Buffer.from([0x63, 0x61, 0x66, 0xe9]), { status: 200 }),
      ],
    ])

    const doc = await bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'file:latin1.txt', {})

    expect(doc?.skippedReason).toBeUndefined()
    expect(doc?.content).toContain('café')
    expect(doc?.content).not.toContain('\uFFFD')
  })

  it('rethrows a transient failure so the sync records it instead of reading it as a deletion', async () => {
    mockApi([[/\/src\/[a-f0-9]+\/flaky\.md$/, () => jsonResponse({ type: 'error' }, 500)]])

    await expect(
      bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'file:flaky.md', {})
    ).rejects.toThrow(/500/)
  })
})
