/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { codaConnector } from '@/connectors/coda/coda'

const doc = {
  id: 'doc-1',
  name: 'Handbook',
  browserLink: 'https://coda.io/d/_ddoc-1',
  updatedAt: '2026-09-16T00:00:00Z',
}
const page = {
  id: 'canvas-1',
  name: 'Welcome',
  browserLink: 'https://coda.io/d/_ddoc-1/Welcome_s1',
  contentType: 'canvas',
  isHidden: false,
  isEffectivelyHidden: false,
}
const table = {
  id: 'grid-1',
  name: 'Tasks',
  browserLink: 'https://coda.io/d/_ddoc-1/Tasks_t1',
  tableType: 'table',
}
const config = { docIds: ['doc-1'] }
const line = (content: string) => ({ type: 'line', itemContent: { format: 'plainText', content } })

describe('Coda connector', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reconciles a deleted explicit document but never treats authorization failure as deletion', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    expect(await codaConnector.listDocuments('token', config)).toMatchObject({
      documents: [],
      hasMore: false,
      reconciliationSafe: true,
    })
    await expect(codaConnector.listDocuments('token', config)).rejects.toMatchObject({
      status: 403,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects persisted document cursors after the configured scope changes', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
    const first = await codaConnector.listDocuments('token', config)
    await expect(
      codaConnector.listDocuments('token', { docIds: ['other'] }, first.nextCursor)
    ).rejects.toThrow('different document scope')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('validates one document and one ACL page using a bounded setup probe', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ loginId: 'owner@example.com' }))
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json({ items: [], nextPageToken: 'more' }))
    expect(
      await codaConnector.validateConfig(
        'token',
        { docIds: ['doc-1', 'doc-2'] },
        { mirrorsSourceAcls: true }
      )
    ).toEqual({ valid: true })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(String(fetch.mock.calls[2][0])).toContain('/acl/permissions?limit=1')
  })

  it('lists deferred pages then base tables and resumes without fetching content', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json({ items: [page], nextPageToken: 'pages-2' }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(
        Response.json({ items: [table, { ...table, id: 'view', tableType: 'view' }] })
      )
    const first = await codaConnector.listDocuments('token', config)
    expect(first.documents[0]).toMatchObject({
      externalId: 'doc-1/pages/canvas-1',
      contentDeferred: true,
      content: '',
      estimatedBytes: 12 * 1024 * 1024,
    })
    const second = await codaConnector.listDocuments('token', config, first.nextCursor)
    const third = await codaConnector.listDocuments('token', config, second.nextCursor)
    expect(third.documents.map((item) => item.externalId)).toEqual(['doc-1/tables/grid-1'])
    expect(third.hasMore).toBe(false)
    expect(String(fetch.mock.calls[2][0])).toBe(
      'https://coda.io/apis/v1/docs/doc-1/pages?pageToken=pages-2'
    )
    expect(fetch.mock.calls.every(([url]) => !String(url).endsWith('/content'))).toBe(true)
  })

  it('reuses only the current listing document metadata during deferred hydration', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json({ items: [line('Cached parent')] }))
    const context = {}
    const listed = await codaConnector.listDocuments('token', config, undefined, context)
    const full = await codaConnector.getDocument(
      'token',
      config,
      listed.documents[0].externalId,
      context
    )
    expect(full?.content).toContain('Cached parent')
    expect(full?.contentHash).toBe(listed.documents[0].contentHash)
    expect(
      fetch.mock.calls.filter(([url]) => String(url) === 'https://coda.io/apis/v1/docs/doc-1')
    ).toHaveLength(1)
  })

  it('keeps document discovery separate from child pagination and marks unstable discovery', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [doc], nextPageToken: 'docs-2' }))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [{ ...doc, id: 'doc-2' }] }))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
    const first = await codaConnector.listDocuments('token', {})
    const tables = await codaConnector.listDocuments('token', {}, first.nextCursor)
    const nextDoc = await codaConnector.listDocuments('token', {}, tables.nextCursor)
    expect(first.reconciliationSafe).toBe(false)
    expect(nextDoc.documents[0].externalId).toBe('doc-2/pages/canvas-1')
    expect(String(fetch.mock.calls[3][0])).toBe('https://coda.io/apis/v1/docs?pageToken=docs-2')
  })

  it('resumes a bounded discovery batch without listing the parent collection per document', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [doc, { ...doc, id: 'doc-2' }] }))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
    const first = await codaConnector.listDocuments('token', {})
    const tables = await codaConnector.listDocuments('token', {}, first.nextCursor)
    const second = await codaConnector.listDocuments('token', {}, tables.nextCursor)
    expect(second.documents[0].externalId).toBe('doc-2/pages/canvas-1')
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://coda.io/apis/v1/docs?limit=10',
      'https://coda.io/apis/v1/docs/doc-1/pages?limit=100',
      'https://coda.io/apis/v1/docs/doc-1/tables?limit=100',
      'https://coda.io/apis/v1/docs/doc-2/pages?limit=100',
    ])
  })

  it('omits hidden, inherited-hidden, embedded and synced pages', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(
        Response.json({
          items: [
            page,
            { ...page, isHidden: true },
            { ...page, isEffectivelyHidden: true },
            { ...page, contentType: 'embed' },
            { ...page, contentType: 'syncPage' },
          ],
        })
      )
    expect((await codaConnector.listDocuments('token', config)).documents).toHaveLength(1)
  })

  it('uses the same metadata hash for listing and complete paginated hydration', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json({ items: [page] }))
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json({ items: [line('First')], nextPageToken: 'content-2' }))
      .mockResolvedValueOnce(Response.json({ items: [line('Second')] }))
    const listed = await codaConnector.listDocuments('token', config)
    const hydrated = await codaConnector.getDocument(
      'token',
      config,
      listed.documents[0].externalId
    )
    expect(hydrated).toMatchObject({
      contentHash: listed.documents[0].contentHash,
      contentDeferred: false,
    })
    expect(hydrated?.content).toContain('First\n\nSecond')
  })

  it('retains column identities when names duplicate and fetches every row page', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json(table))
      .mockResolvedValueOnce(
        Response.json({
          items: [
            { id: 'col-1', name: 'Status' },
            { id: 'col-2', name: 'Status' },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ name: 'One', values: { 'col-1': false, 'col-2': ['A', 'B'] } }],
          nextPageToken: 'rows-2',
        })
      )
      .mockResolvedValueOnce(Response.json({ items: [{ name: 'Two', values: { 'col-1': 0 } }] }))
    const result = await codaConnector.getDocument('token', config, 'doc-1/tables/grid-1')
    expect(result?.content).toContain('Status: false\nStatus: A, B')
    expect(result?.content).toContain('Two\nStatus: 0')
  })

  it('fails incomplete hydration without swallowing authorization errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    await expect(
      codaConnector.getDocument('token', config, 'doc-1/pages/canvas-1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it.each([404, 410])('returns null for an unavailable resource (%s)', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({}, { status }))
    await expect(
      codaConnector.getDocument('token', config, 'doc-1/pages/canvas-1')
    ).resolves.toBeNull()
  })

  it('rejects malformed provider lists rather than reconciling them as empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({}))
    await expect(codaConnector.listDocuments('token', {})).rejects.toThrow('invalid response')
  })

  it('rejects repeated content cursors without indexing a partial document', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json({ items: [line('One')], nextPageToken: 'same' }))
      .mockResolvedValueOnce(Response.json({ items: [line('Two')], nextPageToken: 'same' }))
    await expect(
      codaConnector.getDocument('token', config, 'doc-1/pages/canvas-1')
    ).rejects.toThrow('repeated')
  })

  it('bounds provider response bytes even without a content-length header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(' '.repeat(4 * 1024 * 1024 + 1))
    )
    await expect(codaConnector.listDocuments('token', {})).rejects.toThrow('4MB')
  })

  it('rejects unsafe identifiers and out-of-scope hydration before making requests', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(await codaConnector.validateConfig('token', { docIds: '../whoami' })).toMatchObject({
      valid: false,
    })
    await expect(codaConnector.getDocument('token', config, '../pages/canvas-1')).rejects.toThrow()
    await expect(
      codaConnector.getDocument('token', config, 'other/pages/canvas-1')
    ).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not follow provider links or redirects with the token', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ items: [doc], nextPageLink: 'https://evil.example/steal' })
      )
      .mockResolvedValueOnce(Response.json({ items: [page] }))
    await codaConnector.listDocuments('token', {})
    expect(
      fetch.mock.calls.every(
        ([url, options]) =>
          String(url).startsWith('https://coda.io/apis/v1/') && options?.redirect === 'error'
      )
    ).toBe(true)
  })
})
