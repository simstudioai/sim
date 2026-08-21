/**
 * @vitest-environment node
 *
 * The load-bearing logic here is the repository tree walk: a `max_depth` listing
 * that Bitbucket may answer with a `555` timeout, an opaque `next` cursor that
 * cannot be re-cut, and a per-run frontier of directories the walk has not reached.
 * Every path that shortens the listing has to leave `syncContext.listingCapped` set,
 * because the sync engine hard-deletes whatever a full listing omits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bitbucketConnector } from '@/connectors/bitbucket/bitbucket'

const ACCESS_TOKEN = 'bitbucket-token'
const COMMIT = 'e7d158ff7ed5538c28f94cd97a9ad569680fc94e'
const CONFIG = { workspaceSlug: 'acme', repoSlug: 'widgets' }
const PR_CONFIG = { ...CONFIG, contentTypes: 'pullrequests' }

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const REPOSITORY = {
  full_name: 'acme/widgets',
  mainbranch: { name: 'main', target: { hash: COMMIT } },
  links: { html: { href: 'https://bitbucket.org/acme/widgets' } },
}

function fileEntry(path: string, size = 10, attributes: string[] = []) {
  return { type: 'commit_file', path, size, attributes, commit: { hash: COMMIT } }
}

function dirEntry(path: string) {
  return { type: 'commit_directory', path, commit: { hash: COMMIT } }
}

function pullRequestFixture(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `PR ${id}`,
    state: 'OPEN',
    summary: { raw: `Body of ${id}`, markup: 'markdown', html: `<p>Body of ${id}</p>` },
    author: { display_name: 'Ada Lovelace', nickname: 'ada' },
    created_on: '2026-01-01T00:00:00.000000+00:00',
    updated_on: '2026-02-01T00:00:00.000000+00:00',
    links: { html: { href: `https://bitbucket.org/acme/widgets/pull-requests/${id}` } },
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
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bitbucket repository file listing', () => {
  it('lists text files as deferred stubs and drops binary, symlink, and submodule entries', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [
              fileEntry('README.md'),
              fileEntry('logo.png', 2048, ['binary']),
              fileEntry('link.txt', 5, ['link']),
              fileEntry('vendor', 40, ['subrepository']),
              fileEntry('run.sh', 12, ['executable']),
            ],
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['file:README.md', 'file:run.sh'])
    expect(result.documents[0].contentDeferred).toBe(true)
    expect(result.documents[0].content).toBe('')
    expect(result.documents[0].contentHash).toBe(`bitbucket:file:acme/widgets:${COMMIT}:README.md`)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('pins the listing to the resolved tip commit and asks for the documented depth', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [] })]])

    await bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    const url = requestedUrls(/\/src\//)[0]
    expect(url).toContain(`/src/${COMMIT}/`)
    expect(url).toContain('max_depth=5')
    expect(url).toContain('pagelen=100')
  })

  it('applies the path prefix and extension filters to files and prunes unrelated directories', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [
              fileEntry('docs/guide.md'),
              fileEntry('docs/guide.txt'),
              fileEntry('src/index.md'),
              dirEntry('docs/a/b/c/d'),
              dirEntry('src/a/b/c/d'),
            ],
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, pathPrefix: '/docs', fileExtensions: 'md' },
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['file:docs/guide.md'])
    expect(syncContext.pendingDirs).toEqual(['docs/a/b/c/d'])
  })

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
        () => jsonResponse({ values: [dirEntry('a/b/c/d/e'), fileEntry('root.md')] }),
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

  it('replays the opaque next link verbatim instead of rebuilding it', async () => {
    const nextUrl =
      'https://api.bitbucket.org/2.0/repositories/acme/widgets/src/abc/?page=2&opaque=xyz'
    mockApi([
      [/page=2/, () => jsonResponse({ values: [fileEntry('second.md')] })],
      [/\/src\//, () => jsonResponse({ values: [fileEntry('first.md')], next: nextUrl })],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)

    await bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, first.nextCursor, syncContext)

    expect(requestedUrls(/page=2/)).toEqual([nextUrl])
  })

  it('rejects a next cursor that does not point at the Bitbucket Cloud API', async () => {
    mockApi([
      [
        /\/src\//,
        () => jsonResponse({ values: [], next: 'https://evil.example.com/2.0/repositories/x' }),
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

  it('flags the listing capped when even the depth-1 retry times out', async () => {
    mockApi([[/\/src\//, () => new Response('timeout', { status: 555 })]])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
    expect(result.documents).toEqual([])
    expect(requestedUrls(/\/src\//)).toHaveLength(2)
  })

  it('flags the listing capped when a replayed next cursor times out, without re-cutting it', async () => {
    const nextUrl =
      'https://api.bitbucket.org/2.0/repositories/acme/widgets/src/abc/?page=2&max_depth=5'
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
    expect(second.documents).toEqual([])
    /** Exactly one attempt: an opaque cursor is never rebuilt at another depth. */
    expect(requestedUrls(/page=2/)).toHaveLength(1)
  })

  it('leaves the listing reconcilable when a directory is simply absent', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ type: 'error' }, 404)]])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
    expect(result.hasMore).toBe(false)
  })

  it('flags the listing capped when the token stops working mid-walk', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ type: 'error' }, 403)]])

    const syncContext: Record<string, unknown> = {}
    await bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })
})

describe('bitbucket maxItems cap', () => {
  it('flags the listing capped when the cap truncates a page', async () => {
    mockApi([
      [
        /\/src\//,
        () => jsonResponse({ values: [fileEntry('a.md'), fileEntry('b.md'), fileEntry('c.md')] }),
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

  it('flags the listing capped when the code walk ends on the cap and the pull request phase never runs', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [fileEntry('a.md'), fileEntry('b.md')] })]])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, contentTypes: 'all', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags the listing capped when the cap lands on a page boundary with more to come', async () => {
    mockApi([
      [
        /\/src\//,
        () =>
          jsonResponse({
            values: [fileEntry('a.md'), fileEntry('b.md')],
            next: 'https://api.bitbucket.org/2.0/repositories/acme/widgets/src/abc/?page=2',
          }),
      ],
    ])

    const syncContext: Record<string, unknown> = {}
    await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxItems: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves the listing reconcilable when no cap is configured', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [fileEntry('a.md'), fileEntry('b.md')] })]])

    const syncContext: Record<string, unknown> = {}
    const result = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
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

describe('bitbucket pull request listing', () => {
  it('builds the documented collection query', async () => {
    mockApi([[/\/pullrequests/, () => jsonResponse({ values: [pullRequestFixture(7)] })]])

    await bitbucketConnector.listDocuments(ACCESS_TOKEN, PR_CONFIG, undefined, {})

    const url = requestedUrls(/\/pullrequests/)[0]
    expect(url).toContain('pagelen=50')
    /** `+` must reach Bitbucket percent-encoded or it is read as a space. */
    expect(url).toContain('fields=%2Bvalues.summary')
    expect(url).toContain('sort=-id')
    expect(url).toContain('state=OPEN')
  })

  it('repeats the state parameter for each requested state', async () => {
    mockApi([[/\/pullrequests/, () => jsonResponse({ values: [] })]])

    await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...PR_CONFIG, pullRequestState: 'all' },
      undefined,
      {}
    )

    const url = requestedUrls(/\/pullrequests/)[0]
    expect(url).toContain('state=OPEN')
    expect(url).toContain('state=MERGED')
    expect(url).toContain('state=DECLINED')
    expect(url).toContain('state=SUPERSEDED')
  })

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

  it('maps the author-typed body and falls back to the rendered description', async () => {
    mockApi([
      [
        /\/pullrequests/,
        () =>
          jsonResponse({
            values: [
              pullRequestFixture(7),
              pullRequestFixture(8, {
                summary: undefined,
                rendered: { description: { raw: 'Rendered body' } },
              }),
            ],
          }),
      ],
    ])

    const result = await bitbucketConnector.listDocuments(ACCESS_TOKEN, PR_CONFIG, undefined, {})

    expect(result.documents[0].content).toBe('PR 7\n\nBody of 7')
    expect(result.documents[0].contentDeferred).toBe(false)
    expect(result.documents[0].contentHash).toBe(
      'bitbucket:pr:acme/widgets:7:2026-02-01T00:00:00.000000+00:00'
    )
    expect(result.documents[1].content).toBe('PR 8\n\nRendered body')
  })

  it('walks from the code phase into the pull request phase for combined content', async () => {
    mockApi([
      [/\/src\//, () => jsonResponse({ values: [fileEntry('a.md')] })],
      [/\/pullrequests/, () => jsonResponse({ values: [pullRequestFixture(7)] })],
    ])

    const syncContext: Record<string, unknown> = {}
    const first = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, contentTypes: 'all' },
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)

    const second = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, contentTypes: 'all' },
      first.nextCursor,
      syncContext
    )

    expect(second.documents.map((d) => d.externalId)).toEqual(['pr:7'])
    expect(second.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })
})

describe('bitbucket getDocument', () => {
  it('hydrates a file with the same contentHash the listing produced', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [fileEntry('README.md')] })]])

    const syncContext: Record<string, unknown> = {}
    const listed = await bitbucketConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    mockApi([[/\/src\/[a-f0-9]+\/README\.md$/, () => new Response('# Widgets', { status: 200 })]])
    const fetched = await bitbucketConnector.getDocument(
      ACCESS_TOKEN,
      CONFIG,
      'file:README.md',
      syncContext
    )

    expect(fetched?.contentHash).toBe(listed.documents[0].contentHash)
    expect(fetched?.contentDeferred).toBe(false)
    expect(fetched?.content).toBe('README.md\n\n# Widgets')
    expect(fetched?.metadata?.size).toBe(9)
  })

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

  it('surfaces a file with a NUL byte as a skipped binary', async () => {
    mockApi([
      [
        /\/src\/[a-f0-9]+\/data\.md$/,
        () => new Response(Buffer.from([0x61, 0x00, 0x62]), { status: 200 }),
      ],
    ])

    const doc = await bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'file:data.md', {})

    expect(doc?.skippedReason).toMatch(/Binary/)
  })

  it('returns null for a file the ref no longer carries', async () => {
    mockApi([[/\/src\/[a-f0-9]+\/gone\.md$/, () => jsonResponse({ type: 'error' }, 404)]])

    expect(
      await bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'file:gone.md', {})
    ).toBeNull()
  })

  it('rethrows a transient failure so the sync records it instead of reading it as a deletion', async () => {
    mockApi([[/\/src\/[a-f0-9]+\/flaky\.md$/, () => jsonResponse({ type: 'error' }, 500)]])

    await expect(
      bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'file:flaky.md', {})
    ).rejects.toThrow(/500/)
  })

  it('returns null for a pull request the repository no longer has', async () => {
    mockApi([[/\/pullrequests\/9$/, () => jsonResponse({ type: 'error' }, 404)]])

    expect(await bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'pr:9', {})).toBeNull()
  })

  it('rejects an externalId with no recognized resource prefix', async () => {
    mockApi([])

    expect(await bitbucketConnector.getDocument(ACCESS_TOKEN, CONFIG, 'wiki:Home', {})).toBeNull()
  })
})

describe('bitbucket tag mapping', () => {
  it('maps every declared file tag from the listing metadata', async () => {
    mockApi([[/\/src\//, () => jsonResponse({ values: [fileEntry('docs/guide.md', 42)] })]])

    const result = await bitbucketConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})
    const tags = bitbucketConnector.mapTags?.(result.documents[0].metadata ?? {})

    expect(tags).toEqual({
      contentType: 'file',
      title: 'guide.md',
      repository: 'acme/widgets',
      path: 'docs/guide.md',
      size: 42,
    })
  })

  it('maps every declared pull request tag from the listing metadata', async () => {
    mockApi([[/\/pullrequests/, () => jsonResponse({ values: [pullRequestFixture(7)] })]])

    const result = await bitbucketConnector.listDocuments(ACCESS_TOKEN, PR_CONFIG, undefined, {})
    const tags = bitbucketConnector.mapTags?.(result.documents[0].metadata ?? {})

    expect(tags).toEqual({
      contentType: 'pull_request',
      title: 'PR 7',
      repository: 'acme/widgets',
      state: 'OPEN',
      author: 'Ada Lovelace',
      createdAt: new Date('2026-01-01T00:00:00.000000+00:00'),
      updatedAt: new Date('2026-02-01T00:00:00.000000+00:00'),
    })
  })
})

describe('bitbucket validateConfig', () => {
  it('rejects a repository the credential cannot read', async () => {
    mockApi([[/\/repositories\/acme\/widgets$/, () => jsonResponse({ type: 'error' }, 404)]])

    expect(await bitbucketConnector.validateConfig(ACCESS_TOKEN, CONFIG)).toEqual({
      valid: false,
      error: 'Repository "acme/widgets" not found',
    })
  })

  it('rejects a branch or tag that resolves to neither', async () => {
    mockApi([[/\/refs\//, () => jsonResponse({ type: 'error' }, 404)]])

    const result = await bitbucketConnector.validateConfig(ACCESS_TOKEN, {
      ...CONFIG,
      ref: 'nope',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Branch or tag "nope" not found/)
  })

  it('accepts a tag when no branch by that name exists', async () => {
    mockApi([
      [/\/refs\/branches\//, () => jsonResponse({ type: 'error' }, 404)],
      [/\/refs\/tags\//, () => jsonResponse({ name: 'v1.0', target: { hash: COMMIT } })],
    ])

    expect(
      await bitbucketConnector.validateConfig(ACCESS_TOKEN, { ...CONFIG, ref: 'v1.0' })
    ).toEqual({ valid: true })
  })

  it('rejects a non-positive maxItems before spending a request', async () => {
    mockApi([])

    expect(
      await bitbucketConnector.validateConfig(ACCESS_TOKEN, { ...CONFIG, maxItems: '0' })
    ).toEqual({ valid: false, error: 'Max items must be a positive number' })
  })
})
