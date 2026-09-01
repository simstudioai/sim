/**
 * @vitest-environment node
 *
 * `GET /api/2.0/workspace/list` is unpaginated and returns one directory at a
 * time, so the notebook side of this connector is a hand-rolled breadth-first
 * walk whose pending-directory queue rides in the cursor. Everything that can
 * silently shrink a listing lives in that walk — a container type the walk does
 * not recognise, a directory the token cannot read, the document cap — and the
 * sync engine hard-deletes whatever a listing leaves out unless
 * `syncContext.listingCapped` says the listing was partial. Those paths are the
 * bulk of what is asserted here, alongside the stub/`getDocument` hash equality
 * that keeps every sync from re-indexing every notebook.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databricksConnector } from '@/connectors/databricks/databricks'
import { databricksConnectorMeta } from '@/connectors/databricks/meta'

const TOKEN = 'dapi-personal-access-token'
const HOST = 'dbc-1234abcd-5678.cloud.databricks.com'
const ORIGIN = `https://${HOST}`

const NOTEBOOK_CONFIG = { workspaceHost: HOST, contentType: 'notebooks', rootPath: '/Shared' }
const QUERY_CONFIG = { workspaceHost: HOST, contentType: 'queries' }

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function dir(path: string) {
  return { object_type: 'DIRECTORY', path, object_id: path.length }
}

function repo(path: string) {
  return { object_type: 'REPO', path, object_id: path.length }
}

function notebook(path: string, modifiedAt?: number) {
  return {
    object_type: 'NOTEBOOK',
    path,
    object_id: path.length * 1000,
    language: 'PYTHON',
    ...(modifiedAt === undefined ? {} : { modified_at: modifiedAt }),
  }
}

function query(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    display_name: `Query ${id}`,
    query_text: `SELECT ${id}`,
    catalog: 'main',
    schema: 'default',
    owner_user_name: 'ada@example.com',
    lifecycle_state: 'ACTIVE',
    update_time: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Reads the `path` query parameter off a recorded `workspace/list` call. */
function listedPaths(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => new URL(url as string))
    .filter((url) => url.pathname === '/api/2.0/workspace/list')
    .map((url) => url.searchParams.get('path') ?? '')
}

function queryListingUrls(): URL[] {
  return fetchMock.mock.calls
    .map(([url]) => new URL(url as string))
    .filter((url) => url.pathname === '/api/2.0/sql/queries')
}

/**
 * Serves `workspace/list` from a path→objects map. An unmapped path is a 404,
 * which is the Databricks answer for a path that no longer exists.
 */
function mockWorkspace(tree: Record<string, unknown[] | (() => Response)>) {
  fetchMock.mockImplementation(async (url: string) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api/2.0/workspace/list') {
      const path = parsed.searchParams.get('path') ?? ''
      const entry = tree[path]
      if (entry === undefined) {
        return jsonResponse({ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'not found' }, 404)
      }
      /** A factory, not a value: a retried request must not re-read a used body. */
      if (typeof entry === 'function') return entry()
      return jsonResponse({ objects: entry })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

/** Wraps an error body so each (possibly retried) request gets a fresh Response. */
function errorResponse(body: Record<string, string>, status: number): () => Response {
  return () => jsonResponse(body, status)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('databricks notebook traversal', () => {
  it('walks DIRECTORY and REPO containers and indexes only notebooks', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared/team'), repo('/Shared/git-folder')],
      '/Shared/team': [
        notebook('/Shared/team/etl', 1),
        { object_type: 'FILE', path: '/Shared/team/readme.md', object_id: 5 },
        { object_type: 'DASHBOARD', path: '/Shared/team/board.lvdash.json', object_id: 6 },
        { object_type: 'LIBRARY', path: '/Shared/team/lib.jar', object_id: 7 },
      ],
      '/Shared/git-folder': [notebook('/Shared/git-folder/model', 2)],
    })

    const syncContext: Record<string, unknown> = {}
    const result = await databricksConnector.listDocuments(
      TOKEN,
      NOTEBOOK_CONFIG,
      undefined,
      syncContext
    )

    expect(listedPaths().sort()).toEqual(['/Shared', '/Shared/git-folder', '/Shared/team'])
    expect(result.documents.map((doc) => doc.externalId).sort()).toEqual([
      'notebook:/Shared/git-folder/model',
      'notebook:/Shared/team/etl',
    ])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  /**
   * `workspace/list` answers with the object itself when the path is not a
   * directory. Re-queueing that self-reference would list the same path forever.
   */
  it('does not re-queue a container that lists itself', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared'), notebook('/Shared/etl', 1)],
    })

    const result = await databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})

    expect(listedPaths()).toEqual(['/Shared'])
    expect(result.documents).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })

  it('carries the pending queue through the cursor without re-listing or duplicating', async () => {
    /** 60 sibling directories: more than the 50 a single call will list. */
    const children = Array.from({ length: 60 }, (_, i) => dir(`/Shared/d${i}`))
    const tree: Record<string, unknown[]> = { '/Shared': children }
    for (let i = 0; i < 60; i++) {
      tree[`/Shared/d${i}`] = [notebook(`/Shared/d${i}/nb`, i + 1)]
    }
    mockWorkspace(tree)

    const first = await databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeDefined()
    expect(first.documents).toHaveLength(49)

    const firstPaths = listedPaths()
    fetchMock.mockClear()

    const second = await databricksConnector.listDocuments(
      TOKEN,
      NOTEBOOK_CONFIG,
      first.nextCursor,
      {}
    )
    expect(second.hasMore).toBe(false)
    expect(second.documents).toHaveLength(11)

    const secondPaths = listedPaths()
    expect(secondPaths.some((path) => firstPaths.includes(path))).toBe(false)

    const ids = [...first.documents, ...second.documents].map((doc) => doc.externalId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(60)
  })
})

describe('databricks notebook listingCapped', () => {
  it('flags listingCapped when a subdirectory is unreadable', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared/open'), dir('/Shared/locked')],
      '/Shared/open': [notebook('/Shared/open/nb', 1)],
      '/Shared/locked': errorResponse({ error_code: 'PERMISSION_DENIED' }, 403),
    })

    const syncContext: Record<string, unknown> = {}
    const result = await databricksConnector.listDocuments(
      TOKEN,
      NOTEBOOK_CONFIG,
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when a subdirectory has been deleted mid-walk', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared/open'), dir('/Shared/gone')],
      '/Shared/open': [notebook('/Shared/open/nb', 1)],
    })

    const syncContext: Record<string, unknown> = {}
    await databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, syncContext)

    expect(syncContext.listingCapped).toBe(true)
  })

  /**
   * A denied root yields an empty listing, not a partial one. Reporting that as
   * a successful sync of zero documents is worse than failing.
   */
  it('throws rather than reporting an empty sync when the root itself is denied', async () => {
    mockWorkspace({ '/Shared': errorResponse({ error_code: 'PERMISSION_DENIED' }, 403) })

    await expect(
      databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    ).rejects.toThrow(/denied access to \/Shared/)
  })

  it('flags listingCapped when maxDocuments hides notebooks from the same page', async () => {
    mockWorkspace({
      '/Shared': [notebook('/Shared/a', 1), notebook('/Shared/b', 2), notebook('/Shared/c', 3)],
    })

    const syncContext: Record<string, unknown> = {}
    const result = await databricksConnector.listDocuments(
      TOKEN,
      { ...NOTEBOOK_CONFIG, maxDocuments: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset when maxDocuments lands exactly on an exhausted walk', async () => {
    mockWorkspace({
      '/Shared': [notebook('/Shared/a', 1), notebook('/Shared/b', 2)],
    })

    const syncContext: Record<string, unknown> = {}
    const result = await databricksConnector.listDocuments(
      TOKEN,
      { ...NOTEBOOK_CONFIG, maxDocuments: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when maxDocuments stops the walk with directories pending', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared/a'), dir('/Shared/b')],
      '/Shared/a': [notebook('/Shared/a/nb', 1)],
      '/Shared/b': [notebook('/Shared/b/nb', 2)],
    })

    const syncContext: Record<string, unknown> = { totalDocsFetched: 0 }
    const result = await databricksConnector.listDocuments(
      TOKEN,
      { ...NOTEBOOK_CONFIG, maxDocuments: '1' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBe(true)
  })
})

describe('databricks notebook error semantics under concurrency', () => {
  /**
   * The walk lists siblings in parallel. A permission failure on one sibling has
   * to stay a skip while a server failure on another still aborts the whole
   * listing — a `Promise.all` that swallowed either would be invisible in the
   * happy path.
   */
  it('propagates a 500 on one sibling even when another sibling is a skippable 403', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared/locked'), dir('/Shared/broken')],
      '/Shared/locked': errorResponse({ error_code: 'PERMISSION_DENIED' }, 403),
      '/Shared/broken': errorResponse({ error_code: 'INTERNAL_ERROR', message: 'boom' }, 500),
    })

    await expect(
      databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    ).rejects.toThrow(/Failed to list Databricks workspace path \/Shared\/broken: 500/)
  })

  it('propagates a 401 rather than treating a bad token as an empty directory', async () => {
    mockWorkspace({
      '/Shared': [dir('/Shared/a')],
      '/Shared/a': errorResponse({ error_code: 'PERMISSION_DENIED' }, 401),
    })

    await expect(
      databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    ).rejects.toThrow(/401/)
  })

  it('propagates a 429 after the shared retry budget is spent', async () => {
    vi.useFakeTimers()
    mockWorkspace({
      '/Shared': [dir('/Shared/a')],
      '/Shared/a': errorResponse({ error_code: 'REQUEST_LIMIT_EXCEEDED' }, 429),
    })

    const pending = databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    const assertion = expect(pending).rejects.toThrow(/429/)
    await vi.runAllTimersAsync()
    await assertion
  })
})

describe('databricks saved SQL queries', () => {
  it('drops trashed queries without suppressing deletion reconciliation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [query('a'), query('b', { lifecycle_state: 'TRASHED' })],
      })
    )

    const syncContext: Record<string, unknown> = {}
    const result = await databricksConnector.listDocuments(
      TOKEN,
      QUERY_CONFIG,
      undefined,
      syncContext
    )

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['query:a'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when the cap stops paging while a page token remains', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [query('a'), query('b')], next_page_token: 'tok' })
    )

    const syncContext: Record<string, unknown> = {}
    const result = await databricksConnector.listDocuments(
      TOKEN,
      { ...QUERY_CONFIG, maxDocuments: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset when the cap lands on the last page', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [query('a'), query('b')] }))

    const syncContext: Record<string, unknown> = {}
    await databricksConnector.listDocuments(
      TOKEN,
      { ...QUERY_CONFIG, maxDocuments: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  /**
   * An echoed token on an empty tail would re-request the same page until the
   * engine truncates pagination, which permanently disables deletion
   * reconciliation.
   */
  it('stops paging on an empty page even when a token is echoed back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [], next_page_token: 'tok' }))

    const result = await databricksConnector.listDocuments(TOKEN, QUERY_CONFIG, undefined, {})

    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
  })

  it('asks for the full page size when no cap is configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [query('a')] }))

    await databricksConnector.listDocuments(TOKEN, QUERY_CONFIG, undefined, {})

    expect(queryListingUrls()[0].searchParams.get('page_size')).toBe('100')
  })

  it('shrinks the last page to what the cap still allows', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [query('a')] }))

    await databricksConnector.listDocuments(
      TOKEN,
      { ...QUERY_CONFIG, maxDocuments: '10' },
      undefined,
      { totalDocsFetched: 7 }
    )

    expect(queryListingUrls()[0].searchParams.get('page_size')).toBe('3')
  })

  /**
   * `page_size=0` is not a valid request. The cap arithmetic must floor at one
   * even when the running total has already reached (or overshot) the cap.
   */
  it.each([
    ['exactly at the cap', 10],
    ['past the cap', 12],
  ])('never requests a non-positive page size when already %s', async (_label, fetched) => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await databricksConnector.listDocuments(
      TOKEN,
      { ...QUERY_CONFIG, maxDocuments: '10' },
      undefined,
      { totalDocsFetched: fetched }
    )

    const pageSize = Number(queryListingUrls()[0].searchParams.get('page_size'))
    expect(pageSize).toBeGreaterThan(0)
  })
})

describe('databricks contentHash consistency', () => {
  it('produces the same notebook hash from the listing stub and from getDocument', async () => {
    mockWorkspace({ '/Shared': [notebook('/Shared/etl', 1700000000000)] })

    const listed = await databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    const stub = listed.documents[0]
    expect(stub.contentDeferred).toBe(true)
    expect(stub.content).toBe('')

    fetchMock.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/2.0/workspace/get-status') {
        return jsonResponse(notebook('/Shared/etl', 1700000000000))
      }
      if (parsed.pathname === '/api/2.0/workspace/export') {
        expect(parsed.searchParams.get('format')).toBe('SOURCE')
        return jsonResponse({
          content: Buffer.from('print("hi")', 'utf8').toString('base64'),
          file_type: 'py',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const hydrated = await databricksConnector.getDocument(TOKEN, NOTEBOOK_CONFIG, stub.externalId)

    expect(hydrated?.contentHash).toBe(stub.contentHash)
    expect(hydrated?.externalId).toBe(stub.externalId)
    expect(hydrated?.contentDeferred).toBe(false)
    expect(hydrated?.content).toBe('print("hi")')
    expect(hydrated?.sourceUrl).toBe(`${ORIGIN}/#notebook/${'/Shared/etl'.length * 1000}`)
  })

  /**
   * `modified_at` is documented as file-only, so a notebook routinely carries no
   * timestamp at all. Its hash must still be stable across syncs — a clock- or
   * fetch-derived component would make every sync re-index every notebook. The
   * cost of that stability is that edits go unseen until a full resync, which is
   * exactly what `rehydrateOnFullSync` covers.
   */
  it('keeps an undated notebook hash stable across repeated listings', async () => {
    mockWorkspace({ '/Shared': [notebook('/Shared/etl')] })

    const first = await databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})
    const second = await databricksConnector.listDocuments(TOKEN, NOTEBOOK_CONFIG, undefined, {})

    expect(first.documents[0].contentHash).toBe('databricks:notebook:/Shared/etl:')
    expect(second.documents[0].contentHash).toBe(first.documents[0].contentHash)
  })

  it('produces the same query hash from the listing and from getDocument', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [query('q1')] }))
    const listed = await databricksConnector.listDocuments(TOKEN, QUERY_CONFIG, undefined, {})
    const stub = listed.documents[0]

    fetchMock.mockResolvedValue(jsonResponse(query('q1')))
    const refetched = await databricksConnector.getDocument(TOKEN, QUERY_CONFIG, stub.externalId)

    expect(refetched?.contentHash).toBe(stub.contentHash)
    expect(refetched?.content).toBe(stub.content)
  })

  it('returns null for a notebook that has been deleted since the listing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'gone' }, 404)
    )

    await expect(
      databricksConnector.getDocument(TOKEN, NOTEBOOK_CONFIG, 'notebook:/Shared/gone')
    ).resolves.toBeNull()
  })

  it('reports an oversize export as a skip rather than losing the notebook', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/2.0/workspace/get-status') {
        return jsonResponse(notebook('/Shared/big', 5))
      }
      return jsonResponse({ error_code: 'MAX_NOTEBOOK_SIZE_EXCEEDED', message: 'too big' }, 400)
    })

    const doc = await databricksConnector.getDocument(
      TOKEN,
      NOTEBOOK_CONFIG,
      'notebook:/Shared/big'
    )

    expect(doc?.skippedReason).toMatch(/10MB size limit/)
    expect(doc?.contentHash).toBe(`databricks:notebook:/Shared/big:5`)
  })
})

describe('databricks configuration', () => {
  it('declares rehydrateOnFullSync so undated notebook edits stay recoverable', () => {
    expect(databricksConnectorMeta.rehydrateOnFullSync).toBe(true)
  })

  it('refuses a workspace host outside the Databricks-owned domains', async () => {
    const result = await databricksConnector.validateConfig(TOKEN, {
      workspaceHost: 'evil.example.com',
      contentType: 'notebooks',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Databricks-hosted domain/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to list against a host outside the allowlist', async () => {
    await expect(
      databricksConnector.listDocuments(
        TOKEN,
        { ...NOTEBOOK_CONFIG, workspaceHost: 'evil.example.com' },
        undefined,
        {}
      )
    ).rejects.toThrow(/Databricks-hosted domain/)
  })

  it('rejects a root path that names a notebook instead of a folder', async () => {
    fetchMock.mockResolvedValue(jsonResponse(notebook('/Shared/etl', 1)))

    const result = await databricksConnector.validateConfig(TOKEN, {
      ...NOTEBOOK_CONFIG,
      rootPath: '/Shared/etl',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/is a notebook, not a folder/)
  })

  it('accepts a Git folder as the notebook root', async () => {
    fetchMock.mockResolvedValue(jsonResponse(repo('/Repos/ada/project')))

    await expect(
      databricksConnector.validateConfig(TOKEN, {
        ...NOTEBOOK_CONFIG,
        rootPath: '/Repos/ada/project',
      })
    ).resolves.toEqual({ valid: true })
  })

  it('normalizes a relative, trailing-slashed root path to an absolute one', async () => {
    fetchMock.mockResolvedValue(jsonResponse(dir('/Shared/team')))

    await databricksConnector.validateConfig(TOKEN, {
      ...NOTEBOOK_CONFIG,
      rootPath: '  Shared/team/  ',
    })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('path')).toBe('/Shared/team')
  })
})

describe('databricks mapTags', () => {
  it('maps notebook metadata to the declared tag slots', () => {
    const tags = databricksConnector.mapTags?.({
      language: 'PYTHON',
      lastModified: '2026-01-01T00:00:00.000Z',
      path: '/Shared/etl',
    })

    expect(tags?.language).toBe('PYTHON')
    expect(tags?.lastModified).toBeInstanceOf(Date)
  })

  it('maps query metadata, including the joined tag array', () => {
    const tags = databricksConnector.mapTags?.({
      owner: 'ada@example.com',
      catalog: 'main',
      schema: 'default',
      labels: ['finance', 'daily'],
      lastModified: '2026-01-01T00:00:00Z',
    })

    expect(tags).toMatchObject({
      owner: 'ada@example.com',
      catalog: 'main',
      schema: 'default',
      labels: 'finance, daily',
    })
  })

  it('emits only tag ids the connector declares', () => {
    const declared = new Set(databricksConnectorMeta.tagDefinitions?.map((tag) => tag.id))
    const produced = databricksConnector.mapTags?.({
      language: 'SQL',
      owner: 'ada@example.com',
      catalog: 'main',
      schema: 'default',
      labels: ['a'],
      lastModified: '2026-01-01T00:00:00Z',
    })

    for (const key of Object.keys(produced ?? {})) {
      expect(declared.has(key)).toBe(true)
    }
  })
})
