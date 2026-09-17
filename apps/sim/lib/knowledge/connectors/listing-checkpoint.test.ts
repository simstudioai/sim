/** @vitest-environment node */

import { omit } from '@sim/utils/object'
import { describe, expect, it, vi } from 'vitest'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
  listingFingerprint,
  readListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import {
  googleDriveCompanyCursorAdapter,
  InvalidGoogleCompanyCursor,
} from '@/connectors/google-drive/company-crawl'
import {
  googleWorkspaceCompanyCursorAdapter,
  InvalidGoogleWorkspaceCursor,
} from '@/connectors/google-workspace/company-crawl'
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

  it('durably pins the current page before hydration fails and replays its snapshot', async () => {
    const f = fixture()
    f.listDocuments.mockResolvedValue({
      documents: [doc],
      currentCursor: 'tree-original:0',
      nextCursor: 'tree-original:200',
      hasMore: true,
    })
    f.processPage.mockImplementationOnce(async () => {
      expect(f.saved().cursor).toBe('tree-original:0')
      throw new Error('capacity deferred')
    })
    await expect(runResumableListing(f.input)).rejects.toThrow('capacity deferred')
    expect(f.saved()).toMatchObject({ cursor: 'tree-original:0', listedCount: 0, complete: false })
    const second = fixture(f.saved())
    second.listDocuments.mockResolvedValue({
      documents: [doc],
      currentCursor: 'tree-original:0',
      hasMore: false,
    })
    expect(await runResumableListing(second.input)).toMatchObject({
      complete: true,
      listedCount: 1,
    })
    expect(second.listDocuments.mock.calls[0]?.[2]).toBe('tree-original:0')
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
    const f = fixture({
      ...checkpoint(),
      cursor: 'expired',
      listedCount: 700,
      permissionFailures: true,
    })
    const error = new Error('expired')
    const databaseTime = new Date('2026-09-08T10:00:00Z')
    const getGenerationStartedAt = vi.fn(async () => databaseTime)
    f.listDocuments
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ documents: [doc], hasMore: false })
    const result = await runResumableListing({
      ...f.input,
      getGenerationStartedAt,
      connectorConfig: {
        listDocuments: f.listDocuments,
        isListingCursorInvalidError: (value) => value === error,
      },
    })
    expect(result.generationId).not.toBe('cycle-1')
    expect(result.startedAt).toBe(databaseTime.toISOString())
    expect(getGenerationStartedAt).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ complete: true, listedCount: 1, permissionFailures: false })
    expect(f.listDocuments.mock.calls[1][2]).toBeUndefined()
    expect(f.processPage.mock.calls[0][1].generationId).toBe(result.generationId)
  })

  it.each(['google_drive', 'gmail', 'google_calendar'] as const)(
    'safely restarts when the legacy %s reader receives a partition checkpoint',
    async (provider) => {
      const adapter =
        provider === 'google_drive'
          ? googleDriveCompanyCursorAdapter
          : googleWorkspaceCompanyCursorAdapter(provider)
      const InvalidCursorError =
        provider === 'google_drive' ? InvalidGoogleCompanyCursor : InvalidGoogleWorkspaceCursor
      const cursor = `google-company-work:v2:${Buffer.from(
        JSON.stringify({
          directoryComplete: true,
          directoryRefreshAt: '2026-09-08T11:00:00.000Z',
          phase: 'users',
          revision: 42,
          permissionTurn: true,
          active: { userId: 'user-1', kind: 'permissions' },
        })
      ).toString('base64url')}`
      const f = fixture({
        ...checkpoint(),
        cursor,
        listedCount: 700,
        unsafe: true,
        contentFailures: true,
        permissionFailures: true,
        listingFailures: {
          count: 1,
          samples: [{ scope: 'user@example.com', operation: 'google.user.list', reasons: [] }],
        },
      })
      const databaseTime = new Date('2026-09-08T10:00:00.000Z')
      const getGenerationStartedAt = vi.fn(async () => databaseTime)
      f.listDocuments.mockImplementation(async (_token, _source, savedCursor) => {
        expect(savedCursor).toBe(cursor)
        expect(() => adapter.resume(savedCursor)).toThrow(InvalidCursorError)
        adapter.resume(savedCursor)
        return { documents: [doc], hasMore: false }
      })
      /** The provider readers and restart contract are shared with staging; its envelope parser is not emulated. */
      const restarted = await runResumableListing({
        ...f.input,
        maxPages: 1,
        getGenerationStartedAt,
        connectorConfig: {
          listDocuments: f.listDocuments,
          isListingCursorInvalidError: (error) => error instanceof InvalidCursorError,
        },
      })
      expect(f.processPage).not.toHaveBeenCalled()
      expect(f.saveCheckpoint).toHaveBeenCalledOnce()
      expect(getGenerationStartedAt).toHaveBeenCalledOnce()
      expect(restarted.generationId).not.toBe('cycle-1')
      expect(restarted).toMatchObject({
        fingerprint,
        startedAt: databaseTime.toISOString(),
        cursor: null,
        complete: false,
        listedCount: 0,
        unsafe: false,
        contentFailures: false,
        permissionFailures: false,
        listingFailures: null,
      })
      expect(f.saved()).toEqual(restarted)

      const resumed = fixture(f.saved())
      resumed.listDocuments.mockResolvedValue({
        documents: [doc],
        hasMore: true,
        nextCursor: 'restarted-provider-page-2',
      })
      const incomplete = await runResumableListing({ ...resumed.input, maxPages: 1 })
      expect(resumed.listDocuments.mock.calls[0][2]).toBeUndefined()
      expect(resumed.processPage).toHaveBeenCalledOnce()
      expect(resumed.processPage.mock.calls[0][1].generationId).toBe(restarted.generationId)
      expect(incomplete).toMatchObject({
        generationId: restarted.generationId,
        startedAt: databaseTime.toISOString(),
        cursor: 'restarted-provider-page-2',
        complete: false,
        listedCount: 1,
      })
    }
  )

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

  it('resumes older checkpoints without inventing permission failures', () => {
    const legacy = omit(checkpoint(), ['permissionFailures', 'listingFailures'])
    expect(readListingCheckpoint(legacy, fingerprint)).toMatchObject({
      permissionFailures: false,
      listingFailures: null,
    })
  })

  it('persists partial-scope failures across workers and holds deletion reconciliation at EOF', async () => {
    const failures = {
      count: 1,
      samples: [
        {
          scope: 'user@example.com',
          operation: 'gmail.threads.list',
          status: 400,
          reasons: ['failedPrecondition'],
        },
      ],
    }
    const first = fixture()
    first.listDocuments.mockResolvedValueOnce({
      documents: [],
      currentCursor: 'user-1',
      nextCursor: 'user-2',
      hasMore: true,
      listingFailures: failures,
    })
    await runResumableListing({ ...first.input, maxPages: 1 })
    const resumed = fixture(readListingCheckpoint(first.saved(), fingerprint)!)
    resumed.listDocuments.mockResolvedValueOnce({ documents: [doc], hasMore: false })
    expect(await runResumableListing(resumed.input)).toMatchObject({
      complete: true,
      unsafe: true,
      listedCount: 1,
      listingFailures: failures,
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

  it('clears failed-user evidence only when restarting the entire listing generation', async () => {
    const failures = {
      count: 1,
      samples: [
        {
          scope: 'user@example.com',
          operation: 'gmail.threads.list',
          status: 400,
          reasons: ['failedPrecondition'],
        },
      ],
    }
    const f = fixture({
      ...checkpoint(),
      cursor: 'expired',
      unsafe: true,
      listingFailures: failures,
    })
    const expired = new Error('cursor expired')
    f.listDocuments
      .mockRejectedValueOnce(expired)
      .mockResolvedValueOnce({ documents: [doc], hasMore: false })
    const result = await runResumableListing({
      ...f.input,
      connectorConfig: {
        listDocuments: f.listDocuments,
        isListingCursorInvalidError: (error) => error === expired,
      },
    })
    expect(result).toMatchObject({ complete: true, unsafe: false, listingFailures: null })
    expect(result.generationId).not.toBe('cycle-1')
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
