import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  GoogleDocsIcon: () => null,
}))

import { googleDocsConnector } from '@/connectors/google-docs/google-docs'

const ACCESS_TOKEN = 'token-123'
const DOCUMENT_ID = 'document-abc'
const DRIVE_FILE = {
  id: DOCUMENT_ID,
  name: 'Product plan',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-08-24T12:00:00.000Z',
  createdTime: '2026-08-01T12:00:00.000Z',
  webViewLink: `https://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
  owners: [{ displayName: 'Ada Lovelace' }],
}

function stubFetchDocument(docsResponse: Response) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())

    if (url.hostname === 'www.googleapis.com') {
      return new Response(JSON.stringify({ ...DRIVE_FILE, trashed: false }), { status: 200 })
    }
    if (url.hostname === 'docs.googleapis.com') return docsResponse

    throw new Error(`Unexpected fetch to ${url.toString()}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('googleDocsConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getDocument', () => {
    it.each([{}, { ...DRIVE_FILE, id: 'different-document' }])(
      'rejects malformed Drive metadata instead of replacing retained content',
      async (metadata) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response(JSON.stringify(metadata), { status: 200 }))
        )

        await expect(
          googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)
        ).rejects.toThrow('Google Drive API returned malformed file metadata')
      }
    )

    it('omits credentials from bounded Google API diagnostics', async () => {
      stubFetchDocument(
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Authorization: Bearer production-secret',
              status: 'PERMISSION_DENIED',
            },
          }),
          { status: 403 }
        )
      )

      await expect(googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)).rejects.toThrow(
        `Failed to fetch Google Doc content ${DOCUMENT_ID}: 403`
      )
    })

    it('redacts canonical credential keys from an unexpected Google error envelope', async () => {
      const secret = 'opaque-client-secret-that-must-not-escape'
      stubFetchDocument(
        new Response(JSON.stringify({ metadata: { client_secret: secret } }), { status: 400 })
      )

      const error = await googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID).then(
        () => undefined,
        (caught) => caught as Error
      )

      expect(error?.message).toBe(`Failed to fetch Google Doc content ${DOCUMENT_ID}: 400`)
      expect(error?.message).not.toContain(secret)
    })

    it('rejects an empty tab object instead of replacing retained content', async () => {
      stubFetchDocument(new Response(JSON.stringify({ tabs: [{}] }), { status: 200 }))

      await expect(googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)).rejects.toThrow(
        'Google Docs API returned a malformed document response'
      )
    })

    it('maps an oversized chunked hydration response to a visible skip', async () => {
      const chunk = new Uint8Array(34 * 1024 * 1024)
      let chunksSent = 0
      let streamCancelled = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksSent += 1
          controller.enqueue(chunk)
        },
        cancel() {
          streamCancelled = true
        },
      })
      stubFetchDocument(new Response(stream, { status: 200 }))

      await expect(
        googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)
      ).resolves.toMatchObject({
        externalId: DOCUMENT_ID,
        content: '',
        contentDeferred: false,
        skippedReason: 'File exceeds the 100MB size limit and was not indexed',
      })
      expect(chunksSent).toBeGreaterThanOrEqual(3)
      expect(streamCancelled).toBe(true)
    })

    it('does not authoritatively replace prior content for an embedded-object-only doc', async () => {
      stubFetchDocument(
        new Response(
          JSON.stringify({
            tabs: [
              {
                documentTab: {
                  body: { content: [] },
                  inlineObjects: { image1: { inlineObjectProperties: {} } },
                },
              },
            ],
          }),
          { status: 200 }
        )
      )

      const document = await googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)

      expect(document).toMatchObject({
        content: '',
        contentDeferred: false,
        skippedReason: 'Document contains non-text elements but no extractable text',
      })
      expect(document?.skippedExistingDisposition).toBeUndefined()
    })

    it('keeps the metadata hash identical between listing and hydration', async () => {
      let driveRequestCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const url = new URL(typeof input === 'string' ? input : input.toString())
          if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
            return new Response(JSON.stringify({ files: [DRIVE_FILE] }), { status: 200 })
          }
          if (url.hostname === 'www.googleapis.com') {
            driveRequestCount += 1
            return new Response(JSON.stringify({ ...DRIVE_FILE, trashed: false }), { status: 200 })
          }
          if (url.hostname === 'docs.googleapis.com') {
            return new Response(
              JSON.stringify({
                tabs: [
                  {
                    documentTab: {
                      body: {
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Content\n' } }] } },
                        ],
                      },
                    },
                  },
                ],
              }),
              { status: 200 }
            )
          }
          throw new Error(`Unexpected fetch to ${url.toString()}`)
        })
      )

      const listing = await googleDocsConnector.listDocuments(ACCESS_TOKEN, {})
      const hydrated = await googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)

      expect(listing.documents[0]?.contentDeferred).toBe(true)
      expect(hydrated?.contentHash).toBe(listing.documents[0]?.contentHash)
      expect(driveRequestCount).toBe(1)
    })
  })

  describe('listDocuments', () => {
    it('does not issue another Drive request after a lowered cap is already exhausted', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const syncContext: Record<string, unknown> = { totalDocsFetched: 5 }

      const result = await googleDocsConnector.listDocuments(
        ACCESS_TOKEN,
        { maxDocs: '2' },
        'stale-page-token',
        syncContext
      )

      expect(result).toEqual({ documents: [], hasMore: false })
      expect(syncContext.listingCapped).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('suppresses reconciliation when Drive reports an incomplete search', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            files: [DRIVE_FILE],
            incompleteSearch: true,
          }),
          { status: 200 }
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const syncContext: Record<string, unknown> = {}

      const result = await googleDocsConnector.listDocuments(
        ACCESS_TOKEN,
        {},
        undefined,
        syncContext
      )

      expect(result.documents.map((document) => document.externalId)).toEqual([DOCUMENT_ID])
      expect(result.hasMore).toBe(false)
      expect(result.reconciliationSafe).toBe(false)
      expect(syncContext.listingCapped).toBe(true)
    })

    it('suppresses reconciliation when the cap is reached with another Drive page', async () => {
      const files = [DRIVE_FILE, { ...DRIVE_FILE, id: 'document-def', name: 'Launch plan' }]
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            files,
            nextPageToken: 'next-page-token',
          }),
          { status: 200 }
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const syncContext: Record<string, unknown> = {}

      const result = await googleDocsConnector.listDocuments(
        ACCESS_TOKEN,
        { maxDocs: '2' },
        undefined,
        syncContext
      )

      expect(result.documents).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeUndefined()
      expect(syncContext.listingCapped).toBe(true)
    })
  })
})
