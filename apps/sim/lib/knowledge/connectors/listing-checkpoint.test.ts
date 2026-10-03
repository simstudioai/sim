import { omit } from '@sim/utils/object'
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

  it.each([undefined, 'page-2'])(
    'rejects a missing or repeated continuation before writing that page',
    async (nextCursor) => {
      const f = fixture({ ...checkpoint(), cursor: 'page-2' })
      f.listDocuments.mockResolvedValue({ documents: [doc], hasMore: true, nextCursor })
      await expect(runResumableListing(f.input)).rejects.toThrow('pagination did not advance')
      expect(f.processPage).not.toHaveBeenCalled()
    }
  )

  it('resumes older checkpoints without inventing permission failures', () => {
    const legacy = omit(checkpoint(), ['permissionFailures', 'listingFailures'])
    expect(readListingCheckpoint(legacy, fingerprint)).toMatchObject({
      permissionFailures: false,
      listingFailures: null,
    })
  })

  it('does not double-count a replayed cumulative failure snapshot', async () => {
    const failures = {
      count: 2,
      samples: [
        { scope: 'user@example.com', operation: 'calendar.events.list', status: 403, reasons: [] },
      ],
    }
    const f = fixture({ ...checkpoint(), cursor: 'user-1', listingFailures: failures })
    f.listDocuments.mockResolvedValueOnce({
      documents: [],
      currentCursor: 'user-1',
      nextCursor: 'user-2',
      hasMore: true,
      listingFailures: failures,
    })
    expect(await runResumableListing({ ...f.input, maxPages: 1 })).toMatchObject({
      listingFailures: failures,
      unsafe: true,
    })
    expect(f.saved().listingFailures?.count).toBe(2)
  })

  it('rejects unbounded or malformed failure evidence before processing a page', async () => {
    const f = fixture()
    const sample = {
      scope: 'user@example.com',
      operation: 'gmail.threads.list',
      status: 400,
      reasons: ['failedPrecondition'],
    }
    f.listDocuments.mockResolvedValueOnce({
      documents: [doc],
      hasMore: false,
      listingFailures: { count: 11, samples: Array(11).fill(sample) },
    })
    await expect(runResumableListing(f.input)).rejects.toThrow()
    expect(f.processPage).not.toHaveBeenCalled()
    expect(
      readListingCheckpoint(
        { ...checkpoint(), listingFailures: { count: -1, samples: [] } },
        fingerprint
      )
    ).toBeNull()
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
