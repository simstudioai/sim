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

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: vi.fn().mockResolvedValue(undefined),
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
import { OCR_IMAGE_MIME_TYPES } from '@/lib/knowledge/documents/ocr-request-policy'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'

/** The source URL is downloaded under the caller's access before inline OCR admission. */
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

function parse(signal?: AbortSignal) {
  return runWithKnowledgeModelInputProvenance(
    undefined,
    () =>
      processDocument(PDF_URL, 'Contract.pdf', 'application/pdf', 1024, 200, 1, {
        userId: 'user-1',
        signal,
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
    vi.useRealTimers()
  })

  it('reads a private source once and sends bounded inline PDFs without cloud staging', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: { pageCount: 1001 } })
    mockDownload.mockResolvedValue(await pdfOfPages(1001))
    const counts: number[] = []
    mockExecuteMistralParse.mockImplementation(async (input) => {
      expect(input.filePath).toBeUndefined()
      expect(input.file.type).toBe('application/pdf')
      const bytes = Buffer.from(input.file.base64, 'base64')
      expect(bytes.length).toBeLessThanOrEqual(50_000_000)
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.load(bytes)
      counts.push(pdf.getPageCount())
      return {
        success: true,
        output: {
          pages: ocrPages(pdf.getPageCount()),
          usage_info: { pages_processed: pdf.getPageCount() },
        },
      }
    })
    const result = await parse()
    expect(mockDownload).toHaveBeenCalledTimes(1)
    expect(counts.sort((a, b) => b - a)).toEqual([1000, 1])
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(result.metadata.cloudUrl).toBeUndefined()
  })

  it('accepts a bounded inline PDF without attempting a network source download', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: { pageCount: 1 } })
    const bytes = await pdfOfPages(1)
    mockExecuteMistralParse.mockResolvedValue({
      success: true,
      output: {
        pages: ocrPages(1),
        usage_info: { pages_processed: 1 },
      },
    })
    const result = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          `data:application/pdf;base64,${bytes.toString('base64')}`,
          'inline.pdf',
          'application/pdf',
          1024,
          0,
          1,
          { userId: 'user-1' }
        ),
      { opaqueInputSafe: true }
    )
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockExecuteMistralParse).toHaveBeenCalledOnce()
  })

  it.each([...OCR_IMAGE_MIME_TYPES])(
    'uses image OCR for %s instead of a text parser',
    async (mimeType) => {
      mockExecuteMistralParse.mockResolvedValue({
        success: true,
        output: {
          pages: ocrPages(1, 'Recovered image text'),
          usage_info: { pages_processed: 1 },
        },
      })
      const result = await runWithKnowledgeModelInputProvenance(
        undefined,
        () =>
          processDocument(
            `data:${mimeType};base64,aW1hZ2U=`,
            'image-fixture',
            mimeType,
            1024,
            0,
            1,
            { userId: 'user-1' }
          ),
        { opaqueInputSafe: true }
      )
      expect(result.metadata.processingMethod).toBe('mistral-ocr')
      expect(result.chunks[0].text).toBe('Recovered image text')
      expect(mockParseBuffer).not.toHaveBeenCalled()
      expect(mockExecuteMistralParse).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.objectContaining({ type: mimeType, base64: 'aW1hZ2U=' }),
        }),
        expect.anything()
      )
    }
  )

  it('uses the Azure image_url envelope for an image source', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-document-ai-2512',
    })
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        pages: ocrPages(1, 'Recovered Azure image text'),
        usage_info: { pages_processed: 1 },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument('data:image/png;base64,aW1hZ2U=', 'image.png', 'image/png', 1024, 0, 1, {
          userId: 'user-1',
        }),
      { opaqueInputSafe: true }
    )
    expect(result.chunks[0].text).toBe('Recovered Azure image text')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).document).toEqual({
      type: 'image_url',
      image_url: 'data:image/png;base64,aW1hZ2U=',
    })
  })

  it('does not mistake cancellation of the text-layer read for a reason to run OCR', async () => {
    const controller = new AbortController()
    mockDownload.mockImplementationOnce(async () => {
      controller.abort(new Error('document cancelled'))
      throw controller.signal.reason
    })
    await expect(parse(controller.signal)).rejects.toThrow('document cancelled')
    expect(mockExecuteMistralParse).not.toHaveBeenCalled()
    expect(mockDownload).toHaveBeenCalledWith(
      PDF_URL,
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('honors the Mistral retry delay and aborts the wait without another paid call', async () => {
    mockDownload.mockResolvedValue(await pdfOfPages(1))
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    vi.useFakeTimers()
    const controller = new AbortController()
    mockExecuteMistralParse.mockRejectedValue(new MistralOperationError(429, {}, 60_000))
    const pending = parse(controller.signal)
    const rejected = expect(pending).rejects.toThrow('document cancelled')
    await vi.waitFor(() => expect(mockExecuteMistralParse).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(59_000)
    expect(mockExecuteMistralParse).toHaveBeenCalledOnce()
    controller.abort(new Error('document cancelled'))
    await rejected
    expect(mockExecuteMistralParse).toHaveBeenCalledOnce()
  })

  it('honors Azure Retry-After rather than retrying inside the provider window', async () => {
    mockDownload.mockResolvedValue(await pdfOfPages(1))
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'retry-after': '60' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ pages: ocrPages(1), usage_info: { pages_processed: 1 } }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const pending = parse()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).metadata.processingMethod).toBe('mistral-ocr')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
    expect(error).toMatchObject({ message: expect.stringMatching(/incomplete page result/) })
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
