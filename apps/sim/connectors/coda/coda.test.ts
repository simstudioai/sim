import { describe, expect, it, vi } from 'vitest'
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
const _table = {
  id: 'grid-1',
  name: 'Tasks',
  browserLink: 'https://coda.io/d/_ddoc-1/Tasks_t1',
  tableType: 'table',
}
const config = { docIds: ['doc-1'] }
const line = (content: string) => ({ type: 'line', itemContent: { format: 'plainText', content } })

describe('Coda connector', () => {
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

  it('fails incomplete hydration without swallowing authorization errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(doc))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    await expect(
      codaConnector.getDocument('token', config, 'doc-1/pages/canvas-1')
    ).rejects.toMatchObject({ status: 403 })
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
