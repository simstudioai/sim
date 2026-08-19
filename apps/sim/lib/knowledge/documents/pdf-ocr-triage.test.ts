/**
 * @vitest-environment node
 *
 * Every PDF used to be sent to OCR, an external per-document call, even though the
 * large majority carry a usable text layer that costs nothing to read. These pin
 * the routing: the text layer is tried first, and OCR is reached only when it is
 * missing or unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseBuffer, mockDownload, mockGetDocumentProxy, mockToken, mockBaseUrl } = vi.hoisted(
  () => ({
    mockParseBuffer: vi.fn(),
    mockDownload: vi.fn(),
    mockGetDocumentProxy: vi.fn(),
    mockToken: vi.fn(),
    mockBaseUrl: vi.fn(),
  })
)

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
vi.mock('unpdf', () => ({ getDocumentProxy: mockGetDocumentProxy }))

import { env } from '@/lib/core/config/env'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'

/** External, so the OCR path uses the URL directly instead of re-uploading it. */
const PDF_URL = 'https://example.com/Contract.pdf'
const typeset = 'The Supplier shall provide the Services described herein. '.repeat(60)

function parse() {
  return runWithKnowledgeModelInputProvenance(
    undefined,
    () => processDocument(PDF_URL, 'Contract.pdf', 'application/pdf', 1024, 200, 1, 'user-1'),
    { opaqueInputSafe: true }
  )
}

describe('PDF OCR triage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(env, { OCR_PROVIDER: 'mistral', MISTRAL_API_KEY: 'key' })
    mockDownload.mockResolvedValue(Buffer.from('%PDF-1.7'))
    mockGetDocumentProxy.mockResolvedValue({ numPages: 2 })
    mockToken.mockResolvedValue('internal-token')
    mockBaseUrl.mockReturnValue('http://sim.local')
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

  it('falls through to OCR when the PDF is a scan', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pages: [{ markdown: 'Recognised text' }], usage_info: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(fetchMock).toHaveBeenCalled()
  })

  /**
   * The case a length check alone cannot see: a CID-keyed font with no Unicode map
   * yields plenty of characters, none of them words.
   */
  it('falls through to OCR when the text layer is raw CID escapes', async () => {
    mockParseBuffer.mockResolvedValue({ content: '/31 /8 /18 /12 /44 '.repeat(60), metadata: {} })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pages: [{ markdown: 'Recognised' }], usage_info: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
  })

  /** An encrypted or malformed PDF has no readable layer, which is a case for OCR. */
  it('falls through to OCR when the text layer cannot be parsed at all', async () => {
    mockParseBuffer.mockRejectedValue(new Error('Invalid PDF structure.'))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pages: [{ markdown: 'Recognised' }], usage_info: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await parse()

    expect(result.metadata.processingMethod).toBe('mistral-ocr')
  })
})
