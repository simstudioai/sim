/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
  listingFingerprint,
  readListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import type { ExternalDocument } from '@/connectors/types'

const fingerprint = listingFingerprint({ source: 'drive', folder: 'folder-1' })
const doc: ExternalDocument = {
  externalId: 'file',
  title: 'File',
  content: 'Body',
  mimeType: 'text/plain',
  contentHash: 'v1',
}
function checkpoint() {
  return beginListingCheckpoint({
    fingerprint,
    generationId: 'cycle-1',
    startedAt: new Date('2026-09-04T00:00:00Z'),
  })
}
function fixture(initial = checkpoint()) {
  let saved = initial
  const listDocuments = vi.fn()
  const processPage = vi.fn(async () => undefined)
  const saveCheckpoint = vi.fn(async (value: ListingCheckpoint) => {
    saved = structuredClone(value)
  })
  const input = {
    connectorConfig: { listDocuments },
    sourceConfig: {},
    syncContext: {},
    checkpoint: initial,
    deadlineAt: Date.now() + 60_000,
    beforePage: vi.fn(async () => undefined),
    getAccessToken: vi.fn(async () => 'fixture-token'),
    processPage,
    saveCheckpoint,
  }
  return { input, listDocuments, processPage, saveCheckpoint, saved: () => saved }
}

describe('durable connector listing checkpoints', () => {
  it('resumes the next page in another run with the same observation generation', async () => {
    const f = fixture()
    f.listDocuments.mockResolvedValueOnce({ documents: [doc], hasMore: true, nextCursor: 'page-2' })
    const first = await runResumableListing({ ...f.input, maxPages: 1 })
    expect(first).toMatchObject({
      cursor: 'page-2',
      complete: false,
      listedCount: 1,
      generationId: 'cycle-1',
    })
    const second = fixture(f.saved())
    second.listDocuments.mockResolvedValueOnce({
      documents: [{ ...doc, externalId: 'other' }],
      hasMore: false,
    })
    const result = await runResumableListing(second.input)
    expect(second.listDocuments).toHaveBeenCalledWith(
      'fixture-token',
      {},
      'page-2',
      expect.anything(),
      undefined
    )
    expect(result).toMatchObject({
      complete: true,
      listedCount: 2,
      generationId: 'cycle-1',
      startedAt: first.startedAt,
    })
  })

  it('does not advance when page persistence fails, so the same page can replay', async () => {
    const f = fixture({ ...checkpoint(), cursor: 'page-2', listedCount: 1 })
    f.listDocuments.mockResolvedValue({ documents: [doc], hasMore: false })
    f.processPage.mockRejectedValueOnce(new Error('write failed'))
    await expect(runResumableListing(f.input)).rejects.toThrow('write failed')
    expect(f.saveCheckpoint).not.toHaveBeenCalled()
    expect(f.saved().cursor).toBe('page-2')
  })

  it('does not save a cursor after its write lease is lost', async () => {
    const f = fixture()
    f.listDocuments.mockResolvedValue({ documents: [doc], hasMore: true, nextCursor: 'page-2' })
    f.saveCheckpoint.mockRejectedValueOnce(new Error('lease reclaimed'))
    await expect(runResumableListing(f.input)).rejects.toThrow('lease reclaimed')
    expect(f.saved().cursor).toBeNull()
    expect(f.listDocuments).toHaveBeenCalledTimes(1)
  })

  it('retains a partially processed page and its failure evidence until every batch completes', async () => {
    const f = fixture({ ...checkpoint(), cursor: 'page-2', listedCount: 1 })
    f.listDocuments.mockResolvedValue({
      documents: [doc],
      hasMore: false,
      reconciliationSafe: false,
    })
    const partial = await runResumableListing({
      ...f.input,
      processPage: async (_documents, cycle) => {
        cycle.contentFailures = true
        return false
      },
    })
    expect(partial).toMatchObject({
      cursor: 'page-2',
      listedCount: 1,
      complete: false,
      unsafe: true,
      contentFailures: true,
    })
    const resumed = fixture(f.saved())
    resumed.listDocuments.mockResolvedValue({ documents: [doc], hasMore: false })
    expect(await runResumableListing(resumed.input)).toMatchObject({
      listedCount: 2,
      complete: true,
      unsafe: true,
      contentFailures: true,
    })
  })

  it('keeps unsafe evidence sticky across a restart and never treats EOF as authoritative', async () => {
    const f = fixture()
    f.listDocuments.mockResolvedValueOnce({
      documents: [doc],
      hasMore: true,
      nextCursor: 'page-2',
      reconciliationSafe: false,
    })
    const first = await runResumableListing({ ...f.input, maxPages: 1 })
    const next = fixture(first)
    next.listDocuments.mockResolvedValueOnce({ documents: [], hasMore: false })
    expect(await runResumableListing(next.input)).toMatchObject({ complete: true, unsafe: true })
  })

  it('stops at a deadline without losing the next page', async () => {
    const f = fixture({ ...checkpoint(), cursor: 'page-2' })
    const result = await runResumableListing({ ...f.input, deadlineAt: Date.now() - 1 })
    expect(result.cursor).toBe('page-2')
    expect(f.listDocuments).not.toHaveBeenCalled()
  })

  it('retains a durable content failure when later workers finish healthy pages', async () => {
    const f = fixture()
    f.listDocuments.mockResolvedValueOnce({ documents: [doc], hasMore: true, nextCursor: 'page-2' })
    await runResumableListing({
      ...f.input,
      maxPages: 1,
      processPage: async (_documents, cycle) => {
        cycle.contentFailures = true
      },
    })
    const next = fixture(f.saved())
    next.listDocuments.mockResolvedValueOnce({ documents: [], hasMore: false })
    expect(await runResumableListing(next.input)).toMatchObject({
      complete: true,
      contentFailures: true,
      generationId: 'cycle-1',
    })
  })

  it.each([undefined, 'page-2'])(
    'rejects a missing or repeated continuation before writing that page',
    async (nextCursor) => {
      const f = fixture({ ...checkpoint(), cursor: 'page-2' })
      f.listDocuments.mockResolvedValue({ documents: [doc], hasMore: true, nextCursor })
      await expect(runResumableListing(f.input)).rejects.toThrow('pagination did not advance')
      expect(f.processPage).not.toHaveBeenCalled()
    }
  )

  it('restarts an expired provider cursor once with a new generation', async () => {
    const f = fixture({ ...checkpoint(), cursor: 'expired', listedCount: 700 })
    const error = new Error('expired')
    f.listDocuments
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ documents: [doc], hasMore: false })
    const result = await runResumableListing({
      ...f.input,
      connectorConfig: {
        listDocuments: f.listDocuments,
        isListingCursorInvalidError: (value) => value === error,
      },
    })
    expect(result.generationId).not.toBe('cycle-1')
    expect(result).toMatchObject({ complete: true, listedCount: 1 })
    expect(f.listDocuments.mock.calls[1][2]).toBeUndefined()
    expect(f.processPage.mock.calls[0][1].generationId).toBe(result.generationId)
  })

  it('finishes a source larger than 50,000 documents without retaining its whole listing', async () => {
    const f = fixture()
    let processed = 0
    f.listDocuments.mockImplementation(async (_token, _source, cursor) => {
      const page = Number(cursor ?? 0)
      return {
        documents: Array.from({ length: 5000 }, (_, i) => ({ ...doc, externalId: `${page}-${i}` })),
        hasMore: page < 10,
        nextCursor: page < 10 ? String(page + 1) : undefined,
      }
    })
    const result = await runResumableListing({
      ...f.input,
      processPage: async (documents) => {
        processed += documents.length
      },
    })
    expect(result).toMatchObject({ complete: true, listedCount: 55_000 })
    expect(processed).toBe(55_000)
  })

  it('does not replay provider pages when EOF was already saved before a worker restart', async () => {
    const f = fixture({ ...checkpoint(), complete: true, listedCount: 10 })
    expect(await runResumableListing(f.input)).toMatchObject({ complete: true, listedCount: 10 })
    expect(f.listDocuments).not.toHaveBeenCalled()
  })

  it('rejects checkpoints from a changed configuration or malformed serialized value', () => {
    expect(readListingCheckpoint(checkpoint(), fingerprint)).toEqual(checkpoint())
    expect(
      readListingCheckpoint(checkpoint(), listingFingerprint({ folder: 'changed' }))
    ).toBeNull()
    expect(readListingCheckpoint({ ...checkpoint(), startedAt: 'invalid' }, fingerprint)).toBeNull()
    expect(listingFingerprint({ a: 1, b: 2 })).toBe(listingFingerprint({ b: 2, a: 1 }))
  })
})
