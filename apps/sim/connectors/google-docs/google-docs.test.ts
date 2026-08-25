/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getDocument', () => {
    it('authoritatively skips a listed document that changed type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ ...DRIVE_FILE, mimeType: 'application/pdf', trashed: false }),
              { status: 200 }
            )
        )
      )

      await expect(
        googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)
      ).resolves.toMatchObject({
        content: '',
        skippedReason: 'File is no longer a Google Doc',
        skippedExistingDisposition: 'replace',
      })
    })

    it('requests the tab response view and extracts nested tab content', async () => {
      const fetchMock = stubFetchDocument(
        new Response(
          JSON.stringify({
            tabs: [
              {
                documentTab: {
                  body: {
                    content: [
                      {
                        paragraph: {
                          paragraphStyle: { namedStyleType: 'HEADING_1' },
                          elements: [{ textRun: { content: 'Overview\n' } }],
                        },
                      },
                      {
                        table: {
                          tableRows: [
                            {
                              tableCells: [
                                {
                                  content: [
                                    {
                                      paragraph: {
                                        elements: [{ textRun: { content: 'Table cell\n' } }],
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                childTabs: [
                  {
                    documentTab: {
                      body: {
                        content: [
                          {
                            paragraph: {
                              elements: [
                                {
                                  richLink: {
                                    richLinkProperties: {
                                      title: 'Linked specification',
                                      uri: 'https://example.com/spec',
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        )
      )

      const document = await googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)

      expect(document?.content).toBe('# Overview\nTable cell\nLinked specification')
      expect(document?.contentDeferred).toBe(false)

      const docsCall = fetchMock.mock.calls.find(([input]) =>
        input.toString().startsWith('https://docs.googleapis.com/')
      )
      expect(docsCall).toBeDefined()

      const docsUrl = new URL(docsCall?.[0].toString() ?? '')
      expect(docsUrl.pathname).toBe(`/v1/documents/${DOCUMENT_ID}`)
      expect(docsUrl.searchParams.get('includeTabsContent')).toBe('true')
      expect(docsUrl.searchParams.get('fields')).toBe('tabs')
    })

    it('omits the structured Google API error message when hydration fails', async () => {
      stubFetchDocument(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Invalid field selection tabs',
              status: 'INVALID_ARGUMENT',
            },
          }),
          { status: 400 }
        )
      )

      await expect(googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)).rejects.toThrow(
        `Failed to fetch Google Doc content ${DOCUMENT_ID}: 400`
      )
    })

    it('omits a structured Google API error message from an envelope larger than 2KB', async () => {
      stubFetchDocument(
        new Response(
          JSON.stringify({
            padding: 'x'.repeat(3000),
            error: {
              code: 400,
              message: 'Invalid field selection tabs',
              status: 'INVALID_ARGUMENT',
            },
          }),
          { status: 400 }
        )
      )

      await expect(googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)).rejects.toThrow(
        `Failed to fetch Google Doc content ${DOCUMENT_ID}: 400`
      )
    })

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

    it('returns only the status when an error envelope exceeds the diagnostic limit', async () => {
      const secret = 'over-limit-provider-secret-that-must-not-escape'
      stubFetchDocument(
        new Response(`${'x'.repeat(64 * 1024)}${secret}`, {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const error = await googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID).then(
        () => undefined,
        (caught) => caught as Error
      )

      expect(error?.message).toBe(`Failed to fetch Google Doc content ${DOCUMENT_ID}: 400`)
      expect(error?.message).not.toContain('response body omitted')
      expect(error?.message).not.toContain(secret)
    })

    it('marks an empty tab response as an authoritative skip', async () => {
      stubFetchDocument(new Response(JSON.stringify({ tabs: [] }), { status: 200 }))

      await expect(
        googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)
      ).resolves.toMatchObject({
        content: '',
        contentDeferred: false,
        skippedExistingDisposition: 'replace',
        skippedReason: 'Document contains no extractable text',
      })
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

    it('extracts headers, footers, and footnotes from every tab', async () => {
      stubFetchDocument(
        new Response(
          JSON.stringify({
            tabs: [
              {
                documentTab: {
                  body: { content: [] },
                  headers: {
                    header1: {
                      content: [
                        { paragraph: { elements: [{ textRun: { content: 'Header text\n' } }] } },
                      ],
                    },
                    dateHeader: {
                      content: [
                        {
                          paragraph: {
                            elements: [
                              {
                                dateElement: {
                                  dateElementProperties: { displayText: 'Aug 24, 2026' },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  footers: {
                    footer1: {
                      content: [
                        { paragraph: { elements: [{ textRun: { content: 'Footer text\n' } }] } },
                      ],
                    },
                  },
                  footnotes: {
                    footnote1: {
                      content: [
                        {
                          paragraph: { elements: [{ textRun: { content: 'Footnote text\n' } }] },
                        },
                      ],
                    },
                  },
                },
              },
              {
                documentTab: {
                  body: { content: [] },
                  headers: {
                    siblingHeader: {
                      content: [
                        {
                          paragraph: {
                            elements: [{ textRun: { content: 'Sibling header\n' } }],
                          },
                        },
                      ],
                    },
                  },
                  footnotes: {
                    siblingFootnote: {
                      content: [
                        {
                          paragraph: {
                            elements: [{ textRun: { content: 'Sibling footnote\n' } }],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          }),
          { status: 200 }
        )
      )

      await expect(
        googleDocsConnector.getDocument(ACCESS_TOKEN, {}, DOCUMENT_ID)
      ).resolves.toMatchObject({
        content:
          'Header text\nAug 24, 2026\nFooter text\nFootnote text\nSibling header\nSibling footnote',
        contentDeferred: false,
      })
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

    it('does not authoritatively replace prior content for an equation-only doc', async () => {
      stubFetchDocument(
        new Response(
          JSON.stringify({
            tabs: [
              {
                documentTab: {
                  body: {
                    content: [{ paragraph: { elements: [{ equation: {} }] } }],
                  },
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

    it('keeps an exactly exhausted cap authoritative when Drive is exhausted', async () => {
      const files = [DRIVE_FILE, { ...DRIVE_FILE, id: 'document-def', name: 'Launch plan' }]
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ files }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const syncContext: Record<string, unknown> = {}

      const result = await googleDocsConnector.listDocuments(
        ACCESS_TOKEN,
        { maxDocs: '2' },
        undefined,
        syncContext
      )

      expect(result.documents.map((document) => document.externalId)).toEqual([
        DOCUMENT_ID,
        'document-def',
      ])
      expect(result).toMatchObject({ hasMore: false })
      expect(result.nextCursor).toBeUndefined()
      expect(syncContext.listingCapped).toBeUndefined()
      expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('pageSize')).toBe('2')
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

    it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
      'rejects invalid persisted maxDocs %s before calling Google Drive',
      async (maxDocs) => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(googleDocsConnector.listDocuments(ACCESS_TOKEN, { maxDocs })).rejects.toThrow(
          'Max documents must be a positive safe integer, or 0 for unlimited'
        )
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it.each([undefined, null, '', '   ', 0, '0'])(
      'keeps omitted or explicit unlimited maxDocs %s valid at runtime',
      async (maxDocs) => {
        const fetchMock = vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ files: [], nextPageToken: null }), { status: 200 })
          )
        vi.stubGlobal('fetch', fetchMock)

        await expect(
          googleDocsConnector.listDocuments(ACCESS_TOKEN, { maxDocs })
        ).resolves.toMatchObject({ documents: [], hasMore: false })
        expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('pageSize')).toBe('100')
      }
    )
  })

  describe('validateConfig', () => {
    it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
      'rejects invalid maxDocs %s before calling Google Drive',
      async (maxDocs) => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const result = await googleDocsConnector.validateConfig(ACCESS_TOKEN, { maxDocs })

        expect(result).toEqual({
          valid: false,
          error: 'Max documents must be a positive safe integer, or 0 for unlimited',
        })
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )
  })
})
