import { getAllMockLoggers } from '@sim/testing/mocks/logger.mock'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { listConfluenceAttachments } from '@/connectors/confluence/attachments'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import type { ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { CONNECTOR_MAX_FILE_BYTES } from '@/connectors/utils'

const { secureDownload } = vi.hoisted(() => ({ secureDownload: vi.fn() }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/knowledge/documents/secure-fetch.server')>()),
  secureFetchWithRetry: secureDownload,
}))

const CONFIG = { domain: 'example.atlassian.net', spaceKey: 'ENG' }
const IMAGES_ON = { ...CONFIG, imageAttachments: 'semantic' }
const CONTEXT = { cloudId: 'cloud', spaceId: '1' }
const INPUT = { accessToken: 'token', cloudId: 'cloud', domain: CONFIG.domain, includeImages: true }
const fetchMock = vi.fn<typeof fetch>()

function file(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att123',
    title: 'Guide.pdf',
    status: 'current',
    pageId: 'p1',
    fileSize: 12,
    version: { number: 2, createdAt: '2026-09-01T00:00:00Z' },
    webuiLink: '/spaces/ENG/pages/p1?preview=att123',
    ...overrides,
  }
}

function parent(id = 'p1', type = 'page'): ExternalDocument {
  return {
    externalId: id,
    title: id,
    content: '',
    mimeType: 'text/plain',
    contentHash: id,
    metadata: { contentType: type },
  }
}

function fixture(attachment = file()) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))
    const path = url.pathname
    if (path.endsWith('/attachments/att123')) return Response.json(attachment)
    if (path.endsWith('/pages/p1/attachments')) return Response.json({ results: [attachment] })
    if (path.endsWith('/spaces/1/pages'))
      return Response.json({
        results: [
          { id: 'p1', title: 'Parent', status: 'current', spaceId: '1', version: { number: 1 } },
        ],
      })
    if (path.endsWith('/pages/p1'))
      return Response.json({ id: 'p1', status: 'current', spaceId: '1' })
    if (path.endsWith('/spaces/1')) return Response.json({ key: 'ENG' })
    if (path.endsWith('/pages/p1/labels'))
      return Response.json({ results: [{ name: 'published' }] })
    if (path.endsWith('/download'))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://files.atlassian.net/signed-file?token=secret' },
      })
    if (path.endsWith('/spaces/1/permissions'))
      return Response.json({
        results: [
          {
            principal: { type: 'user', id: 'reader' },
            operation: { key: 'read', targetType: 'space' },
          },
        ],
      })
    if (path.endsWith('/restriction/byOperation/read'))
      return Response.json({
        restrictions: { user: { results: [] }, group: { results: [{ id: 'parent-readers' }] } },
      })
    if (path.endsWith('/ancestors')) return Response.json({ results: [] })
    throw new Error(`Unexpected request: ${url}`)
  })
}

async function get(
  externalId = 'attachment:page:p1:att123',
  config: Record<string, unknown> = CONFIG
) {
  return confluenceConnector.getDocument('token', config, externalId, { ...CONTEXT })
}

const ROUNDTRIP_TEXT = 'Confluence attachment text'
const OOXML_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const PRESENTATION_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

async function pdfBytes(): Promise<Buffer> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  document.addPage().drawText(ROUNDTRIP_TEXT, { font, size: 14 })
  return Buffer.from(await document.save())
}

async function docxBytes(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    `<Relationships ${PACKAGE_RELS_NS}><Relationship Id="rId1" Type="${OOXML_REL}/officeDocument" Target="word/document.xml"/></Relationships>`
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${ROUNDTRIP_TEXT}</w:t></w:r></w:p></w:body></w:document>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** One slide resolved through `p:sldIdLst`, the order the presentation walker follows. */
async function pptxBytes(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
  )
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${PRESENTATION_NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships ${PACKAGE_RELS_NS}><Relationship Id="rId1" Type="${OOXML_REL}/slide" Target="slides/slide1.xml"/></Relationships>`
  )
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${PRESENTATION_NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${ROUNDTRIP_TEXT}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function xlsxBytes(): Promise<Buffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['Note'], [ROUNDTRIP_TEXT]]),
    'Sheet1'
  )
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const _ROUNDTRIP_FIXTURES = {
  pdf: pdfBytes,
  docx: docxBytes,
  pptx: pptxBytes,
  xlsx: xlsxBytes,
} as const

beforeEach(() => {
  fetchMock.mockReset()
  secureDownload.mockReset().mockResolvedValue(new Response('binary bytes'))
  vi.stubGlobal('fetch', fetchMock)
})

describe('Confluence attachment listing', () => {
  it('resumes a bounded parent queue with a fresh runtime context', async () => {
    fetchMock.mockImplementation(async () => Response.json({ results: [] }))
    const listParents = vi.fn(
      async (): Promise<ExternalDocumentList> => ({
        documents: Array.from({ length: 8 }, (_, index) => parent(`p${index}`)),
        hasMore: false,
      })
    )
    const first = await listConfluenceAttachments({ ...INPUT, listParents })
    expect(first.documents).toHaveLength(8)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(first.hasMore).toBe(true)
    const last = await listConfluenceAttachments({
      ...INPUT,
      listParents,
      cursor: first.nextCursor,
      syncContext: { totalDocsFetched: 8000 },
    })
    expect(last.hasMore).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(listParents).toHaveBeenCalledTimes(1)
  })

  it('follows attachment continuations beyond the per-call request budget', async () => {
    fetchMock.mockImplementation(async (input) => {
      const cursor = Number(new URL(String(input)).searchParams.get('cursor') || 0)
      return Response.json({
        results: [file({ id: String(cursor) })],
        _links: cursor < 6 ? { next: `?cursor=${cursor + 1}` } : {},
      })
    })
    const listParents = vi.fn(
      async (): Promise<ExternalDocumentList> => ({ documents: [parent()], hasMore: false })
    )
    const first = await listConfluenceAttachments({ ...INPUT, listParents })
    const last = await listConfluenceAttachments({
      ...INPUT,
      listParents,
      cursor: first.nextCursor,
    })
    expect([...first.documents, ...last.documents].map((doc) => doc.externalId)).toEqual([
      'p1',
      ...Array.from({ length: 7 }, (_, i) => `attachment:page:p1:${i}`),
    ])
    expect(last.hasMore).toBe(false)
  })

  it('preserves parent pages and cumulative partial progress when the attachment scope is missing', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ code: 401, message: 'Unauthorized; scope does not match' }, { status: 401 })
    )
    const listParents = vi.fn(
      async (cursor: string | undefined): Promise<ExternalDocumentList> => ({
        documents: [parent(cursor ? 'p2' : 'p1')],
        hasMore: !cursor,
        nextCursor: cursor ? undefined : 'next',
      })
    )
    const first = await listConfluenceAttachments({ ...INPUT, listParents })
    const context: Record<string, unknown> = {}
    const last = await listConfluenceAttachments({
      ...INPUT,
      listParents,
      cursor: first.nextCursor,
      syncContext: context,
    })
    expect(first.documents.map((doc) => doc.externalId)).toEqual(['p1'])
    expect(last.documents.map((doc) => doc.externalId)).toEqual(['p2'])
    expect(last.listingFailures).toEqual({
      count: 2,
      samples: ['p1', 'p2'].map((scope) => ({
        scope,
        operation: 'confluence.attachments.list',
        status: 401,
        reasons: ['attachment_scope_mismatch'],
      })),
    })
    expect(last.reconciliationSafe).toBe(false)
    expect(context.reconciliationUnsafe).toBe(true)
  })

  /**
   * One page whose attachments the credential cannot open must not leave every pass incomplete,
   * which would keep the connector from ever finishing a sync. Its attachments were not listed,
   * so the page still withholds deletion of anything it did not list.
   */
  it.each([403, 404])(
    'skips a parent whose attachments answer %s without failing the listing or deleting what it did not list',
    async (status) => {
      fetchMock.mockImplementation(async (input) => {
        const parentId = new URL(String(input)).pathname.split('/').at(-2) ?? ''
        if (parentId === 'p1') return new Response(null, { status })
        return Response.json({ results: [file({ id: `${parentId}-file`, pageId: parentId })] })
      })
      const listParents = vi.fn(
        async (): Promise<ExternalDocumentList> => ({
          documents: [parent('p1'), parent('p2')],
          hasMore: false,
        })
      )
      const context: Record<string, unknown> = {}
      const result = await listConfluenceAttachments({
        ...INPUT,
        listParents,
        syncContext: context,
      })
      expect(result.documents.map((doc) => doc.externalId)).toEqual([
        'p1',
        'p2',
        'attachment:page:p2:p2-file',
      ])
      expect(result.hasMore).toBe(false)
      expect(result.listingFailures).toBeUndefined()
      expect(result.reconciliationSafe).toBe(false)
      expect(context.reconciliationUnsafe).toBe(true)
    }
  )

  describe('server errors', () => {
    const parents = (ids: string[]) =>
      vi.fn(
        async (): Promise<ExternalDocumentList> => ({
          documents: ids.map((id) => parent(id)),
          hasMore: false,
        })
      )

    /** Answers a parent's attachment listing with `status` while `failing` says so. */
    function listingFails(failing: (parentId: string) => boolean, status = 500) {
      fetchMock.mockImplementation(async (input) => {
        const parentId = new URL(String(input)).pathname.split('/').at(-2) ?? ''
        if (failing(parentId)) return new Response('upstream error', { status })
        return Response.json({ results: [file({ id: `${parentId}-file`, pageId: parentId })] })
      })
    }

    /** Runs a listing past the shared backoff (~31 s for five retries) without real waits. */
    async function listPastBackoff(input: Parameters<typeof listConfluenceAttachments>[0]) {
      vi.useFakeTimers()
      try {
        const listing = listConfluenceAttachments(input)
        const settled = listing.then(
          () => undefined,
          () => undefined
        )
        for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(10_000)
        await settled
        return await listing
      } finally {
        vi.useRealTimers()
      }
    }

    it.each([
      ['a complete body', () => 'upstream error'],
      ['a body that never finishes', () => new ReadableStream<Uint8Array>()],
      [
        'a body stream that already errored',
        () =>
          new ReadableStream<Uint8Array>({
            start: (controller) => controller.error(new Error('connection reset')),
          }),
      ],
    ])('retries a transient 500 with %s instead of failing the listing', async (_, body) => {
      let failed = false
      fetchMock.mockImplementation(async () => {
        if (failed) return Response.json({ results: [file({ id: 'p1-file' })] })
        failed = true
        return new Response(body(), { status: 500 })
      })
      const result = await listPastBackoff({ ...INPUT, listParents: parents(['p1']) })
      expect(result.documents.map((doc) => doc.externalId)).toEqual([
        'p1',
        'attachment:page:p1:p1-file',
      ])
      expect(result.listingFailures).toBeUndefined()
    })

    it('skips isolated parents whose listing keeps failing and keeps listing the rest', async () => {
      listingFails((id) => id === 'p1' || id === 'p3' || id === 'p5')
      const context: Record<string, unknown> = {}
      const result = await listPastBackoff({
        ...INPUT,
        listParents: parents(['p1', 'p2', 'p3', 'p4', 'p5']),
        syncContext: context,
      })
      expect(result.documents.map((doc) => doc.externalId)).toEqual([
        'p1',
        'p2',
        'p3',
        'p4',
        'p5',
        'attachment:page:p2:p2-file',
        'attachment:page:p4:p4-file',
      ])
      expect(result.listingFailures).toEqual({
        count: 3,
        samples: ['p1', 'p3', 'p5'].map((scope) => ({
          scope,
          operation: 'confluence.attachments.list',
          status: 500,
          reasons: ['attachment_listing_unavailable'],
        })),
      })
      expect(result.reconciliationSafe).toBe(false)
      expect(context.reconciliationUnsafe).toBe(true)
    })

    it('logs Atlassian trace identifiers for a 500 but never its body', async () => {
      let failed = false
      fetchMock.mockImplementation(async () => {
        if (failed) return Response.json({ results: [] })
        failed = true
        return Response.json(
          {
            errors: [{ code: 'INTERNAL_SERVER_ERROR', title: 'x', detail: 'leaked-secret-value' }],
          },
          {
            status: 500,
            headers: { 'atl-traceid': '5c1f0e2a9b7d4e1f', 'x-arequestid': 'not an id; <script>' },
          }
        )
      })
      await listPastBackoff({ ...INPUT, listParents: parents(['p1']) })
      const logged = JSON.stringify(
        getAllMockLoggers().flatMap((logger) =>
          [logger.info, logger.warn, logger.error, logger.debug].flatMap((fn) => fn.mock.calls)
        )
      )
      expect(logged).toContain('5c1f0e2a9b7d4e1f')
      expect(logged).not.toContain('<script>')
      expect(logged).not.toContain('leaked-secret-value')
    })

    it.each([500, 503])(
      'fails the sync when consecutive parents answer %s, as during an outage',
      async (status) => {
        listingFails(() => true, status)
        await expect(
          listPastBackoff({ ...INPUT, listParents: parents(['p1', 'p2', 'p3', 'p4']) })
        ).rejects.toMatchObject({ status })
      }
    )
  })

  it('surfaces known oversized files as skipped without downloading', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ results: [file({ fileSize: CONNECTOR_MAX_FILE_BYTES + 1 })] })
    )
    const result = await listConfluenceAttachments({
      ...INPUT,
      listParents: async () => ({ documents: [parent()], hasMore: false }),
    })
    expect(result.documents[1].skippedReason).toContain('size limit')
    expect(result.documents[1].contentDeferred).toBe(false)
  })

  it.each([
    { results: [], _links: { next: '?wrong=cursor' } },
    { results: [file({ pageId: 'another-parent' })] },
    { results: 'invalid' },
  ])('refuses an incomplete or mismatched attachment list %#', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body))
    await expect(
      listConfluenceAttachments({
        ...INPUT,
        listParents: async () => ({ documents: [parent()], hasMore: false }),
      })
    ).rejects.toThrow()
  })
})

describe('Confluence image attachments', () => {
  async function listOne(attachment: Record<string, unknown>) {
    fetchMock.mockResolvedValue(Response.json({ results: [attachment] }))
    const result = await listConfluenceAttachments({
      ...INPUT,
      listParents: async () => ({ documents: [parent()], hasMore: false }),
    })
    return result.documents.slice(1)
  }

  it.each([
    { title: 'Quarterly schedule.png', mediaType: 'image/png', mimeType: 'image/png' },
    { title: 'image-20240101-000000', mediaType: 'image/jpeg', mimeType: 'image/jpeg' },
    { title: 'Floor plan', mediaType: 'IMAGE/JPG', mimeType: 'image/jpeg' },
    { title: 'Diagram.webp', mediaType: 'image/webp', mimeType: 'image/webp' },
    { title: 'Spinner.gif', mediaType: 'image/gif', mimeType: 'image/gif' },
  ])('lists $title by its media type', async ({ title, mediaType, mimeType }) => {
    const [image] = await listOne(file({ title, mediaType, fileSize: 40_000 }))
    expect(image).toMatchObject({ mimeType, contentDeferred: true })
    expect(image.contentHash).toBe('confluence:attachment-v1:att123:page:p1:2:image-extract-v1')
  })

  it.each([
    { title: 'Logo.svg', mediaType: 'image/svg+xml' },
    { title: 'Photo.heic', mediaType: 'image/heic' },
    { title: 'Photo.avif', mediaType: 'image/avif' },
    { title: 'Archive', mediaType: 'application/zip' },
    { title: 'Unknown', mediaType: undefined },
  ])('drops $title', async ({ title, mediaType }) => {
    expect(await listOne(file({ title, mediaType, fileSize: 40_000 }))).toEqual([])
  })

  it('drops images under the byte floor and keeps one whose size is unreported', async () => {
    expect(
      await listOne(file({ title: 'Icon.png', mediaType: 'image/png', fileSize: 900 }))
    ).toEqual([])
    const [unsized] = await listOne(
      file({ title: 'Chart.png', mediaType: 'image/png', fileSize: undefined })
    )
    expect(unsized.mimeType).toBe('image/png')
  })

  it('keeps document hashes unchanged and still lists small documents', async () => {
    const [pdf] = await listOne(file({ mediaType: 'application/pdf', fileSize: 12 }))
    expect(pdf.contentHash).toBe('confluence:attachment-v1:att123:page:p1:2')
  })

  it('hydrates a listed image with its bytes and the same media type', async () => {
    fixture(file({ title: 'Quarterly schedule', mediaType: 'image/png', fileSize: 40_000 }))
    secureDownload.mockResolvedValue(new Response('png bytes'))
    const hydrated = await get('attachment:page:p1:att123', IMAGES_ON)
    expect(hydrated?.skippedReason).toBeUndefined()
    expect(hydrated?.sourceFile).toMatchObject({
      fileName: 'Quarterly schedule',
      mimeType: 'image/png',
    })
  })

  it('lists no images when the connector turns image attachments off, and keeps documents', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        results: [
          file({ title: 'Quarterly schedule.png', mediaType: 'image/png', fileSize: 40_000 }),
          file({ id: 'att124', title: 'Guide.pdf', mediaType: 'application/pdf' }),
        ],
      })
    )
    const result = await listConfluenceAttachments({
      ...INPUT,
      includeImages: false,
      listParents: async () => ({ documents: [parent()], hasMore: false }),
    })
    expect(result.documents.slice(1).map((doc) => doc.title)).toEqual(['Guide.pdf'])
  })

  it('replaces an indexed image once image attachments are turned off', async () => {
    fixture(file({ title: 'Quarterly schedule', mediaType: 'image/png', fileSize: 40_000 }))
    const hydrated = await get('attachment:page:p1:att123', { ...CONFIG, imageAttachments: 'off' })
    expect(hydrated?.skippedReason).toBe('Image attachments are turned off for this connector')
    expect(hydrated?.skippedExistingDisposition).toBe('replace')
  })

  it('keeps images off for a connector created before the setting existed', async () => {
    fixture(file({ title: 'Quarterly schedule', mediaType: 'image/png', fileSize: 40_000 }))
    const hydrated = await get('attachment:page:p1:att123', CONFIG)
    expect(hydrated?.skippedReason).toBe('Image attachments are turned off for this connector')
  })

  it('replaces an attachment that stopped being a supported image', async () => {
    fixture(file({ title: 'Logo', mediaType: 'image/svg+xml', fileSize: 40_000 }))
    const hydrated = await get()
    expect(hydrated?.skippedReason).toContain('supported image')
    expect(hydrated?.skippedExistingDisposition).toBe('replace')
  })
})

describe('Confluence attachment hydration', () => {
  it.each(['/attachments/att123', '/download'])(
    'reports missing attachment scope without invalidating the credential at %s',
    async (endpoint) => {
      fixture()
      const healthy = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (input, init) =>
        new URL(String(input)).pathname.endsWith(endpoint)
          ? Response.json(
              {
                code: 401,
                message: 'Unauthorized; scope does not match',
                secret: 'must-not-appear',
              },
              { status: 401 }
            )
          : healthy(input, init)
      )
      const error = await get().catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('read:attachment:confluence')
      expect(String(error)).not.toContain('must-not-appear')
      expect(confluenceConnector.isCredentialInvalidError?.(error)).toBe(false)
      expect(secureDownload).not.toHaveBeenCalled()
    }
  )

  it('refuses a file moved after listing even when the token can read the new parent', async () => {
    fixture(file({ pageId: 'private-page' }))
    expect(await get()).toBeNull()
    expect(secureDownload).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a current parent moved out of the selected space', async () => {
    fixture()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith('/spaces/1')
        ? Response.json({ key: 'PRIVATE' })
        : original(input, init)
    )
    expect(await get()).toBeNull()
    expect(secureDownload).not.toHaveBeenCalled()
  })

  it('rejects non-HTTPS redirects before any download and guards subsequent hops', async () => {
    fixture()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes('/download')
        ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
        : original(input, init)
    )
    await expect(get()).rejects.toThrow('unsafe')
    expect(secureDownload).not.toHaveBeenCalled()
    fixture()
    await get()
    expect(() =>
      secureDownload.mock.calls[0][1].assertRedirectTarget('http://internal/file')
    ).toThrow('unsafe')
  })

  it('surfaces an oversized streamed download as a visible skip', async () => {
    fixture()
    secureDownload.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'download', maxBytes: CONNECTOR_MAX_FILE_BYTES })
    )
    expect((await get())?.skippedReason).toContain('size limit')
  })
})

describe('Confluence attachment ACLs', () => {
  it('uses the canonical parent restriction chain and persists its space audience', async () => {
    fixture()
    const listed = await confluenceConnector.listDocuments('token', CONFIG, undefined, {
      ...CONTEXT,
    })
    const persistGroupMembership = vi.fn().mockResolvedValue(undefined)
    const acls = await confluenceConnector.getDocumentAcls!(
      'token',
      CONFIG,
      [listed.documents[1]],
      { ...CONTEXT },
      { persistGroupMembership }
    )
    expect(acls['attachment:page:p1:att123']).toEqual({
      acl: ['g:confluence:cloud:space-readers:1'],
      requirements: [['g:confluence:cloud:parent-readers']],
    })
    expect(persistGroupMembership).toHaveBeenCalledOnce()
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/content/att123/restriction'))
    ).toBe(false)
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/pages/att123/ancestors'))
    ).toBe(false)
  })

  it('fails closed for a moved attachment and for missing audience persistence', async () => {
    fixture()
    const listed = await confluenceConnector.listDocuments('token', CONFIG, undefined, {
      ...CONTEXT,
    })
    const doc = listed.documents[1]
    expect(
      await confluenceConnector.getDocumentAcls!('token', CONFIG, [doc], { ...CONTEXT })
    ).toEqual({})
    fixture(file({ pageId: 'new-parent' }))
    expect(
      await confluenceConnector.getDocumentAcls!(
        'token',
        CONFIG,
        [doc],
        { ...CONTEXT },
        { persistGroupMembership: vi.fn() }
      )
    ).toEqual({})
  })
})
