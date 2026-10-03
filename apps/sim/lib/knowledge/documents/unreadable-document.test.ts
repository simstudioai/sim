/**
 * Connectors now hand their source files to this pipeline instead of extracting
 * text themselves, so the guard against fabricated content has to live here.
 * `DocParser` and `PptxParser` never throw by design: on a legacy OLE binary or a
 * deck with no text they return a placeholder sentence or scraped archive bytes,
 * reporting it as `degraded`. Indexing that would embed junk, so it must fail the
 * document exactly as empty output does.
 */

import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // A developer's .env MISTRAL_API_KEY would route the empty-parse case into
  // the OCR/cloud-upload branch and fail on unmocked uploads; CI has no key.
  // Pin the keyless path so the test is hermetic.
  process.env.MISTRAL_API_KEY = ''
})

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/file-parsers', () => fileParsersMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { processDocument } from '@/lib/knowledge/documents/document-processor'

const mockParseBuffer = fileParsersMockFns.mockParseBuffer

const mockDownload = fileUtilsServerMockFns.mockDownloadFileFromUrl

const CONNECTOR_PDF_URL = '/api/files/serve/s3/kb%2F1-abc-Report.pdf?context=knowledge-base'

function parse(filename: string, mimeType = 'text/plain') {
  mockDownload.mockResolvedValue(Buffer.from('bytes'))
  return processDocument(CONNECTOR_PDF_URL, filename, mimeType)
}

describe('unreadable document handling', () => {
  it('fails a degraded extraction instead of indexing placeholder text', async () => {
    mockParseBuffer.mockResolvedValue({
      content: 'Unable to extract text from PowerPoint file.',
      metadata: { extractionMethod: 'fallback', degraded: true },
    })

    await expect(parse('Deck.pptx')).rejects.toThrow(/No text could be extracted/)
  })

  /**
   * OCR reads a scanned page with no recoverable text as empty. Chunking that
   * yields a document reporting success while holding nothing — the same silent
   * failure the file-parser guard exists to prevent, so it has to cover OCR too.
   */
  it('fails an OCR result that came back empty', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: {} })

    await expect(parse('Scanned.pdf', 'application/pdf')).rejects.toThrow(
      /No text could be extracted/
    )
  })

  it('accepts a real extraction', async () => {
    mockParseBuffer.mockResolvedValue({
      content: 'Approved vendor list',
      metadata: { extractionMethod: 'mammoth' },
    })

    const result = await parse('SOP.docx')

    expect(result.chunks.length).toBeGreaterThan(0)
  })
})
