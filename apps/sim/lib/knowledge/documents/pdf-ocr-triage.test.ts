/**
 * @vitest-environment node
 *
 * Every PDF used to be sent to OCR, an external per-document call, even though the
 * large majority carry a usable text layer that costs nothing to read. These pin
 * the routing: the text layer is tried first, and OCR is reached only when it is
 * missing or unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseBuffer, mockDownload, mockToken, mockBaseUrl, mockExecuteMistralParse } =
  vi.hoisted(() => ({
    mockParseBuffer: vi.fn(),
    mockDownload: vi.fn(),
    mockToken: vi.fn(),
    mockBaseUrl: vi.fn(),
    mockExecuteMistralParse: vi.fn(),
  }))

vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: mockToken }))
vi.mock('@/lib/core/utils/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/utils/urls')>()),
  getInternalApiBaseUrl: mockBaseUrl,
}))

vi.mock('@/lib/file-parsers', () => ({
  parseBuffer: mockParseBuffer,
  isSupportedFileType: (extension: string) => ['pdf'].includes(extension),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({ downloadFileFromUrl: mockDownload }))
vi.mock('@/lib/internal/mistral/operations', () => ({
  executeMistralParse: mockExecuteMistralParse,
}))

import { env } from '@/lib/core/config/env'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'

/** External, so the OCR path uses the URL directly instead of re-uploading it. */
const PDF_URL = 'https://example.com/Contract.pdf'
const typeset = 'The Supplier shall provide the Services described herein. '.repeat(60)

/** A real PDF, because splitting loads the document rather than trusting metadata. */
async function pdfOfPages(count: number): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  for (let i = 0; i < count; i++) pdf.addPage()
  return Buffer.from(await pdf.save())
}

function ocrPages(count: number, markdown = 'Recognised page') {
  return Array.from({ length: count }, () => ({ markdown }))
}

function parse() {
  return runWithKnowledgeModelInputProvenance(
    undefined,
    () =>
      processDocument(PDF_URL, 'Contract.pdf', 'application/pdf', 1024, 200, 1, {
        userId: 'user-1',
      }),
    { opaqueInputSafe: true }
  )
}

describe('PDF OCR triage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(env, { OCR_PROVIDER: 'mistral', MISTRAL_API_KEY: 'key' })
    mockDownload.mockResolvedValue(Buffer.from('%PDF-1.7'))
    mockToken.mockResolvedValue('internal-token')
    mockBaseUrl.mockReturnValue('http://sim.local')
    mockExecuteMistralParse.mockImplementation(async () => {
      const response = await fetch('https://api.mistral.ai/v1/ocr', { method: 'POST' })
      if (!response.ok) {
        throw new MistralOperationError(response.status, {
          success: false,
          error: `Mistral API error: ${response.statusText}`,
        })
      }
      return { success: true, output: await response.json() }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the embedded text layer and never calls OCR', async () => {
    mockParseBuffer.mockResolvedValue({ content: typeset, metadata: {} })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('file-parser')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The density check reads its page count from the same parse as the text. A long
   * scan that yields only a header must stay sparse against its real page count —
   * counting separately allowed a failed count to present it as a single dense page.
   */
  it('takes the page count from the parse, so a header-only scan stays sparse', async () => {
    // Enough to clear the floor as a single page, nowhere near enough for 80.
    const headerOnly = 'CONFIDENTIAL - Vendor Master Agreement - Page header. '.repeat(6)
    mockParseBuffer.mockResolvedValue({ content: headerOnly, metadata: { pageCount: 80 } })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ pages: [{ markdown: 'Recognised' }], usage_info: { pages_processed: 1 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
  })

  it('falls through to OCR when the PDF is a scan', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pages: [{ markdown: 'Recognised text' }],
          usage_info: { pages_processed: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    // 1001 pages against a 1000-page request cap: two chunks, two requests.
    expect(fetchMock).toHaveBeenCalled()
  })

  /**
   * The case a length check alone cannot see: a CID-keyed font with no Unicode map
   * yields plenty of characters, none of them words.
   */
  it('falls through to OCR when the text layer is raw CID escapes', async () => {
    mockParseBuffer.mockResolvedValue({ content: '/31 /8 /18 /12 /44 '.repeat(60), metadata: {} })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ pages: [{ markdown: 'Recognised' }], usage_info: { pages_processed: 1 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
  })

  /** An encrypted or malformed PDF has no readable layer, which is a case for OCR. */
  it('falls through to OCR when the text layer cannot be parsed at all', async () => {
    mockParseBuffer.mockRejectedValue(new Error('Invalid PDF structure.'))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ pages: [{ markdown: 'Recognised' }], usage_info: { pages_processed: 1 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
  })

  it('does not index a Mistral no-pages response as raw provider JSON', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ pages: [], usage_info: { pages_processed: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    await expect(parse()).rejects.toThrow('OCR provider returned no page results')
  })

  it('classifies an OCR request-size rejection as a permanent document failure', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 413 })))

    const error = await parse().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PermanentDocumentProcessingError)
    expect(error).toMatchObject({ code: 'document_complexity_limit' })
  })
})

describe('Azure OCR chunking', () => {
  /**
   * Both providers cap how many pages one OCR request may carry. Mistral split the
   * document to fit; Azure refused anything over the cap, so a long PDF could not
   * be ingested at all. The cap belongs to a request, not to a document.
   */
  it('splits a PDF past the page cap instead of refusing it', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
    mockParseBuffer.mockResolvedValue({ content: '', metadata: { pageCount: 2500 } })
    mockDownload.mockResolvedValue(await pdfOfPages(1001))
    // A fresh Response per call: a body can only be read once.
    let request = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      const pageCount = request++ === 0 ? 1000 : 1
      return new Response(
        JSON.stringify({ pages: ocrPages(pageCount), usage_info: { pages_processed: pageCount } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    // 1001 pages against a 1000-page request cap: two chunks, two requests.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the current Azure model 30-page request envelope', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-document-ai-2512',
    })
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    mockDownload.mockResolvedValue(await pdfOfPages(31))
    let request = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      const pageCount = request++ === 0 ? 30 : 1
      return new Response(
        JSON.stringify({ pages: ocrPages(pageCount), usage_info: { pages_processed: pageCount } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  /**
   * Splitting loads the document, which an encrypted or malformed PDF refuses.
   * Those are precisely the files the triage sends here — no readable text layer —
   * so a failed split must not decide whether they reach OCR at all.
   */
  it('sends a PDF that cannot be split whole rather than refusing it', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
    mockParseBuffer.mockRejectedValue(new Error('Invalid PDF structure.'))
    mockDownload.mockResolvedValue(Buffer.from('not something pdf-lib can load'))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pages: [{ markdown: 'Recognised' }],
          usage_info: { pages_processed: 1 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * A response with no pages is no content. Returning the raw payload would index
   * the API envelope as the document and satisfy the empty-content check meant to
   * catch it.
   */
  it('treats an Azure response carrying no processed pages as an incomplete provider response', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    mockDownload.mockResolvedValue(await pdfOfPages(2))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ pages: [], usage_info: { pages_processed: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    const error = await parse().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PermanentDocumentProcessingError)
    expect(error).toMatchObject({ message: expect.stringMatching(/completed 0 of 1 chunks/) })
  })

  /**
   * A document is indexed whole or not at all. Returning the chunks that did come
   * back would mark the document complete with whole page ranges missing from
   * search, and nothing downstream could tell it apart from a complete one.
   */
  it('fails the document when one chunk of several fails', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    mockDownload.mockResolvedValue(await pdfOfPages(1001))

    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        call++
        if (call === 1) {
          return new Response(
            JSON.stringify({
              pages: ocrPages(1000, 'First half'),
              usage_info: { pages_processed: 1000 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response('upstream failure', { status: 500 })
      })
    )

    const error = await parse().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PermanentDocumentProcessingError)
    expect(error).toMatchObject({ message: expect.stringMatching(/OCR completed 1 of 2 chunks/) })
  })

  it('accepts a page-complete blank range when another range contains text', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    mockDownload.mockResolvedValue(await pdfOfPages(1001))

    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const first = request++ === 0
        const pageCount = first ? 1000 : 1
        return new Response(
          JSON.stringify({
            pages: ocrPages(pageCount, first ? 'First half' : ''),
            usage_info: { pages_processed: pageCount },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })
    )

    const result = await parse()

    expect(result.chunks.some((chunk) => chunk.text.includes('First half'))).toBe(true)
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
  })
})
