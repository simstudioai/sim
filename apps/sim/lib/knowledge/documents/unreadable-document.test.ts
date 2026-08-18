/**
 * @vitest-environment node
 *
 * Connectors now hand their source files to this pipeline instead of extracting
 * text themselves, so the guard against fabricated content has to live here.
 * `DocParser` and `PptxParser` never throw by design: on a legacy OLE binary or a
 * deck with no text they return a placeholder sentence or scraped archive bytes,
 * reporting it as `degraded`. Indexing that would embed junk, so it must fail the
 * document exactly as empty output does.
 */
import { describe, expect, it, vi } from 'vitest'

const { mockParseBuffer, mockDownload } = vi.hoisted(() => ({
  mockParseBuffer: vi.fn(),
  mockDownload: vi.fn(),
}))

vi.mock('@/lib/file-parsers', () => ({ parseBuffer: mockParseBuffer }))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({ downloadFileFromUrl: mockDownload }))

import { processDocument } from '@/lib/knowledge/documents/document-processor'

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

  it('names the modern container for a legacy format, which re-saving genuinely fixes', async () => {
    mockParseBuffer.mockResolvedValue({
      content: 'Unable to extract text from DOC file.',
      metadata: { degraded: true },
    })

    await expect(parse('Contract.doc')).rejects.toThrow(/Re-save it as DOCX/)
  })

  it('explains the likely cause for a modern format', async () => {
    mockParseBuffer.mockResolvedValue({ content: '   ', metadata: {} })

    await expect(parse('Scan.pdf')).rejects.toThrow(/scanned, image-only, or password-protected/)
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
