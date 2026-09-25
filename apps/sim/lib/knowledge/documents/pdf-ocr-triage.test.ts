/**
 * Every PDF used to be sent to OCR, an external per-document call, even though the
 * large majority carry a usable text layer that costs nothing to read. These pin
 * the routing: the text layer is tried first, and OCR is reached only when it is
 * missing or unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { warnLog } = vi.hoisted(() => ({ warnLog: vi.fn() }))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: warnLog, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

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
  ProviderAdmissionTimeoutError: class ProviderAdmissionTimeoutError extends Error {},
  ProviderAdmissionStorageError: class ProviderAdmissionStorageError extends Error {},
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
import { waitForProviderAdmission } from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { FileParserError } from '@/lib/file-parsers/errors'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
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

  it.each(['mistral', 'azure-mistral'])(
    'rejects a Git LFS pointer before %s admission or OCR',
    async (provider) => {
      Object.assign(env, {
        OCR_PROVIDER: provider,
        OCR_AZURE_API_KEY: 'key',
        OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
        OCR_AZURE_MODEL_NAME: 'mistral-document-ai-2512',
      })
      const bytes = Buffer.from(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${'b'.repeat(64)}\nsize 9566\n`
      )
      mockDownload.mockResolvedValue(bytes)
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        processDocument('https://example.com/image.png', 'image.png', 'image/png', 1024, 0, 1, {
          userId: 'user-1',
        })
      ).rejects.toMatchObject({
        name: 'PermanentDocumentProcessingError',
        code: 'invalid_file',
        message: expect.stringContaining('Git LFS pointer'),
      })
      expect(mockDownload).toHaveBeenCalledOnce()
      expect(waitForProviderAdmission).not.toHaveBeenCalled()
      expect(mockExecuteMistralParse).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockParseBuffer).not.toHaveBeenCalled()
    }
  )

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

  it('defers a Mistral throttle without spending the worker budget on another paid call', async () => {
    mockDownload.mockResolvedValue(await pdfOfPages(1))
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    mockExecuteMistralParse.mockRejectedValue(
      new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 60_000 })
    )

    await expect(parse()).rejects.toMatchObject({
      name: 'ProviderCapacityDeferredError',
      reason: 'rate_limit',
      retryAfterMs: 60_000,
    })
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

  it('does not send native extraction safety failures to OCR', async () => {
    mockParseBuffer.mockRejectedValue(
      new FileParserError('complexity_limit', 'PDF page exceeds the safe expansion limit.')
    )

    await expect(parse()).rejects.toMatchObject({
      name: 'PermanentDocumentProcessingError',
      code: 'document_complexity_limit',
      cause: expect.any(FileParserError),
    })
    expect(mockExecuteMistralParse).not.toHaveBeenCalled()
  })

  it('refuses unexpected truncated native results without a paid OCR fallback', async () => {
    mockParseBuffer.mockResolvedValue({
      content: typeset,
      metadata: { pageCount: 1339, truncated: true },
    })

    await expect(parse()).rejects.toMatchObject({
      name: 'PermanentDocumentProcessingError',
      code: 'document_complexity_limit',
    })
    expect(mockExecuteMistralParse).not.toHaveBeenCalled()
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

  /**
   * The parser re-routes by sniffed bytes, so an HTML error page saved as `.pdf`
   * comes back as decoded text that would pass the text-layer check. It is not a
   * PDF and OCR would fail on it terminally, so it must be rejected up front.
   */
  it('rejects a non-PDF file named .pdf instead of indexing its text or sending it to OCR', async () => {
    mockParseBuffer.mockResolvedValue({
      content: 'Access denied. Your request was blocked by the firewall. '.repeat(40),
      metadata: { detectedType: 'html', warning: 'parsed as .html instead of .pdf' },
    })

    await expect(parse()).rejects.toMatchObject({ code: 'invalid_file' })
    expect(mockExecuteMistralParse).not.toHaveBeenCalled()
  })

  it('rejects password-protected PDFs before provider admission', async () => {
    mockParseBuffer.mockRejectedValue(
      Object.assign(new Error('Password needed'), { name: 'PasswordException' })
    )
    await expect(parse()).rejects.toMatchObject({ code: 'encrypted_file' })
    expect(mockExecuteMistralParse).not.toHaveBeenCalled()
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
})
