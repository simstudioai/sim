/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { DEFAULT_MAX_ERROR_BODY_BYTES, PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { parseBuffer } from '@/lib/file-parsers'
import { listConfluenceAttachments } from '@/connectors/confluence/attachments'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import type { ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { CONNECTOR_MAX_FILE_BYTES, PIPELINE_PARSED_MIME_TYPES } from '@/connectors/utils'

const { secureDownload } = vi.hoisted(() => ({ secureDownload: vi.fn() }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/knowledge/documents/secure-fetch.server')>()),
  secureFetchWithRetry: secureDownload,
}))

const CONFIG = { domain: 'example.atlassian.net', spaceKey: 'ENG' }
const CONTEXT = { cloudId: 'cloud', spaceId: '1' }
const INPUT = { accessToken: 'token', cloudId: 'cloud', domain: CONFIG.domain }
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

async function get(externalId = 'attachment:page:p1:att123', config = CONFIG) {
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

const ROUNDTRIP_FIXTURES = {
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
afterEach(() => vi.unstubAllGlobals())

describe('Confluence attachment listing', () => {
  it('lists PDF, Word, PowerPoint and Excel stubs without downloading, and excludes unsupported or archived files', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        results: [
          file(),
          file({ id: '2', title: 'Legacy.DOC' }),
          file({ id: '3', title: 'Modern.docx' }),
          file({ id: '4', title: 'Deck.pptx' }),
          file({ id: '5', title: 'Sheet.XLSX' }),
          file({ id: '6', title: 'image.png' }),
          file({ id: '7', title: 'Macro.pptm' }),
          file({ id: '8', title: 'Legacy.xls' }),
          file({ id: '9', title: 'Old.ppt' }),
          file({ id: '10', title: 'old.pdf', status: 'archived' }),
        ],
      })
    )
    const result = await listConfluenceAttachments({
      ...INPUT,
      listParents: async () => ({ documents: [parent()], hasMore: false }),
    })
    expect(result.documents.map((doc) => doc.externalId)).toEqual([
      'p1',
      'attachment:page:p1:att123',
      'attachment:page:p1:2',
      'attachment:page:p1:3',
      'attachment:page:p1:4',
      'attachment:page:p1:5',
    ])
    expect(result.documents.slice(1).map((doc) => doc.mimeType)).toEqual(
      ['pdf', 'doc', 'docx', 'pptx', 'xlsx'].map((extension) =>
        PIPELINE_PARSED_MIME_TYPES.get(extension)
      )
    )
    expect(
      result.documents.slice(1).every((doc) => doc.contentDeferred && doc.content === '')
    ).toBe(true)
    expect(result.hasMore).toBe(false)
    expect(secureDownload).not.toHaveBeenCalled()
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('status')).toBe('current')
  })

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

  it('keeps parent caps independent of attachment counts across worker resumes', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        results: Array.from({ length: 10 }, (_, index) => file({ id: String(index) })),
      })
    )
    const listParents = vi.fn(
      async (
        cursor: string | undefined,
        context: Record<string, unknown>
      ): Promise<ExternalDocumentList> => {
        expect(context.totalDocsFetched).toBe(cursor ? 1 : 0)
        return {
          documents: [parent()],
          hasMore: !cursor,
          nextCursor: cursor ? undefined : 'next-parent',
        }
      }
    )
    const first = await listConfluenceAttachments({ ...INPUT, listParents })
    expect(first.documents).toHaveLength(11)
    const last = await listConfluenceAttachments({
      ...INPUT,
      listParents,
      cursor: first.nextCursor,
      syncContext: { totalDocsFetched: 11 },
    })
    expect(last.hasMore).toBe(false)
    expect(listParents).toHaveBeenCalledTimes(2)
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

  it.each([403, 401])(
    'preserves parent pages and cumulative partial progress for attachment access failure %s',
    async (status) => {
      fetchMock.mockImplementation(async () =>
        status === 401
          ? Response.json({ code: 401, message: 'Unauthorized; scope does not match' }, { status })
          : new Response(null, { status })
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
          status,
          reasons: [status === 401 ? 'attachment_scope_mismatch' : 'attachment_access_denied'],
        })),
      })
      expect(last.reconciliationSafe).toBe(false)
      expect(context.reconciliationUnsafe).toBe(true)
    }
  )

  it('continues accepting the parent cursor of a listing interrupted before attachments shipped', async () => {
    const listParents = vi.fn(
      async (): Promise<ExternalDocumentList> => ({ documents: [], hasMore: false })
    )
    await listConfluenceAttachments({
      ...INPUT,
      listParents,
      cursor: 'space-batches:{"batch":1,"cursor":"provider"}',
      syncContext: { totalDocsFetched: 27 },
    })
    expect(listParents).toHaveBeenCalledWith(
      'space-batches:{"batch":1,"cursor":"provider"}',
      expect.objectContaining({ totalDocsFetched: 27 })
    )
  })

  it('lists attachments even when only their version changed after the parent page watermark', async () => {
    fixture()
    const result = await confluenceConnector.listDocuments(
      'token',
      CONFIG,
      undefined,
      { ...CONTEXT },
      new Date('2026-09-15')
    )
    expect(result.documents.some((doc) => doc.externalId === 'attachment:page:p1:att123')).toBe(
      true
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('lastModified'))).toBe(false)
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

  it.each([
    null,
    '{"code":401,"message":"Token is invalid","secret":"must-not-appear"}',
    '{"code":403,"message":"Unauthorized; scope does not match"}',
    'invalid JSON',
    'x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1),
  ])('keeps unrecognized 401 responses as credential failures %#', async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 401 }))
    const error = await listConfluenceAttachments({
      ...INPUT,
      listParents: async () => ({ documents: [parent()], hasMore: false }),
    }).catch((error: unknown) => error)
    expect(error).toMatchObject({ status: 401 })
    expect(confluenceConnector.isCredentialInvalidError?.(error)).toBe(true)
    expect(String(error)).not.toContain('must-not-appear')
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

  it.each(['/attachments/att123', '/download'])(
    'preserves expired-credential errors during hydration at %s',
    async (endpoint) => {
      fixture()
      const healthy = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (input, init) =>
        new URL(String(input)).pathname.endsWith(endpoint)
          ? new Response(null, { status: 401 })
          : healthy(input, init)
      )
      const error = await get().catch((error: unknown) => error)
      expect(error).toMatchObject({ status: 401 })
      expect(confluenceConnector.isCredentialInvalidError?.(error)).toBe(true)
      expect(secureDownload).not.toHaveBeenCalled()
    }
  )

  it.each(['pdf', 'doc', 'docx', 'pptx', 'xlsx'])(
    'hands an original %s file to the shared parser pipeline',
    async (extension) => {
      fixture(file({ title: `Guide.${extension}` }))
      const listing = await confluenceConnector.listDocuments('token', CONFIG, undefined, {
        ...CONTEXT,
      })
      const doc = await get()
      expect(doc?.sourceFile?.bytes.toString()).toBe('binary bytes')
      expect(doc?.sourceFile?.fileName).toBe(`Guide.${extension}`)
      expect(doc?.contentHash).toBe(listing.documents[1].contentHash)
      expect(doc?.contentDeferred).toBe(false)
      expect(doc?.mimeType).toBe(doc?.sourceFile?.mimeType)
      const download = fetchMock.mock.calls.find(([url]) => String(url).includes('/download'))!
      expect(String(download[0])).toContain(
        '/content/p1/child/attachment/att123/download?version=2'
      )
      expect(download[1]).toMatchObject({
        redirect: 'manual',
        headers: { Authorization: 'Bearer token' },
      })
      expect(secureDownload.mock.calls[0][1]).toMatchObject({
        profile: 'contentFetch',
        maxResponseBytes: CONNECTOR_MAX_FILE_BYTES,
      })
      expect(secureDownload.mock.calls[0][1].headers).toBeUndefined()
    }
  )

  it.each([
    '/spaces/ENG/pages/p1?preview=att123',
    '/wiki/spaces/ENG/pages/p1?preview=att123',
    'https://example.atlassian.net/wiki/spaces/ENG/pages/p1?preview=att123',
  ])('normalizes provider web links %s', async (webuiLink) => {
    fixture(file({ webuiLink }))
    expect((await get())?.sourceUrl).toBe(
      'https://example.atlassian.net/wiki/spaces/ENG/pages/p1?preview=att123'
    )
  })

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

  it('checks labels beyond the embedded fifty-label page before downloading', async () => {
    fixture()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/labels'))
        return Response.json(
          url.searchParams.has('cursor')
            ? { results: [{ name: 'published' }] }
            : { results: [{ name: 'other' }], _links: { next: '?cursor=second' } }
        )
      return original(input, init)
    })
    expect(
      (await get(undefined, { ...CONFIG, labelFilter: 'published' } as typeof CONFIG))?.sourceFile
    ).toBeDefined()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/labels'))).toHaveLength(2)
  })

  it('does not download when the current parent no longer matches a label filter', async () => {
    fixture()
    expect(await get(undefined, { ...CONFIG, labelFilter: 'missing' } as typeof CONFIG)).toBeNull()
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

  it('releases a rejected signed download response', async () => {
    fixture()
    const cancel = vi.fn()
    secureDownload.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 403 }))
    await expect(get()).rejects.toThrow('Failed to download Confluence attachment: 403')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('passes cancellation through metadata and signed download requests', async () => {
    fixture()
    const signal = new AbortController().signal
    await confluenceConnector.getDocument('token', CONFIG, 'attachment:page:p1:att123', {
      ...CONTEXT,
      signal,
    })
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true)
    expect(secureDownload.mock.calls[0][1].signal).toBe(signal)
  })

  it.each(['pdf', 'docx', 'pptx', 'xlsx'] as const)(
    'roundtrips genuine %s bytes through the public parser',
    async (extension) => {
      const bytes = await ROUNDTRIP_FIXTURES[extension]()
      fixture(file({ title: `Guide.${extension}`, fileSize: bytes.length }))
      secureDownload.mockResolvedValue(new Response(bytes))
      const doc = await get()
      expect(doc?.sourceFile).toBeDefined()
      const parsed = await parseBuffer(doc!.sourceFile!.bytes, extension)
      expect(parsed.content).toContain(ROUNDTRIP_TEXT)
    }
  )

  it.each(['Guide.ppt', 'Guide.xls'])(
    'replaces an attachment renamed to unsupported %s without downloading',
    async (title) => {
      fixture(file({ title }))
      const doc = await get()
      expect(doc?.skippedReason).toBe(
        'Attachment is no longer a PDF, Word, Excel or PowerPoint document'
      )
      expect(doc?.skippedExistingDisposition).toBe('replace')
      expect(doc?.contentDeferred).toBe(false)
      expect(secureDownload).not.toHaveBeenCalled()
    }
  )
})

describe('Confluence attachment ACLs', () => {
  it('hydrates blog post attachments and checks blog restrictions without page ancestors', async () => {
    fixture(file({ pageId: undefined, blogPostId: 'b1' }))
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/blogposts/b1/attachments'))
        return Response.json({ results: [file({ pageId: undefined, blogPostId: 'b1' })] })
      if (path.endsWith('/blogposts/b1'))
        return Response.json({ id: 'b1', spaceId: '1', status: 'current' })
      return original(input, init)
    })
    const listing = await listConfluenceAttachments({
      ...INPUT,
      listParents: async () => ({ documents: [parent('b1', 'blogpost')], hasMore: false }),
    })
    const config = { ...CONFIG, contentType: 'blogpost' }
    const doc = listing.documents[1]
    const hydrated = await confluenceConnector.getDocument('token', config, doc.externalId, {
      ...CONTEXT,
    })
    expect(hydrated?.sourceFile).toBeDefined()
    const acls = await confluenceConnector.getDocumentAcls!(
      'token',
      config,
      [doc],
      { ...CONTEXT },
      { persistGroupMembership: vi.fn() }
    )
    expect(acls[doc.externalId]).toEqual({
      acl: ['g:confluence:cloud:space-readers:1'],
      requirements: [['g:confluence:cloud:parent-readers']],
    })
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/content/b1/restriction'))
    ).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ancestors'))).toBe(false)
  })

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
