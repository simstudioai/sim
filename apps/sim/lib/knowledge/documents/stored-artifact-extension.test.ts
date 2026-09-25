/**
 * A knowledge base document's `filename` is a display name. For connector
 * documents it deliberately disagrees with the stored bytes — the sync engine
 * records `Report.pdf` while storing the text the connector already extracted
 * under a `.txt` key — so choosing a parser from the display name re-parsed
 * extracted text as the source binary. In production that failed 1,379
 * SharePoint PDFs with `Invalid PDF structure.` and silently double-wrapped
 * every spreadsheet, which "succeeded" because SheetJS accepts almost anything.
 */
import { describe, expect, it, vi } from 'vitest'

const { mockDownload } = vi.hoisted(() => ({ mockDownload: vi.fn() }))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({ downloadFileFromUrl: mockDownload }))

import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { resolveStoredArtifactExtension } from '@/lib/knowledge/documents/parser-extension'

const CONNECTOR_PDF_URL =
  '/api/files/serve/s3/kb%2F1786986883507-abc-Report.pdf.txt?context=knowledge-base'
const _UPLOADED_PDF_URL =
  '/api/files/serve/s3/kb%2F1786986883507-abc-Report.pdf?context=knowledge-base'

describe('resolveStoredArtifactExtension', () => {
  it('reports txt for a connector document whose display name is a PDF', () => {
    expect(resolveStoredArtifactExtension(CONNECTOR_PDF_URL)).toBe('txt')
  })

  it('reports txt for a connector spreadsheet, which SheetJS would otherwise re-wrap', () => {
    expect(
      resolveStoredArtifactExtension(
        '/api/files/serve/s3/kb%2F1-abc-Vendor_Spend.xlsx.txt?context=knowledge-base'
      )
    ).toBe('txt')
  })

  it('ignores URLs that are not served from our own storage', () => {
    expect(resolveStoredArtifactExtension('https://example.com/files/Report.pdf')).toBeUndefined()
    expect(resolveStoredArtifactExtension('data:application/pdf;base64,AAAA')).toBeUndefined()
  })
})

describe('stored text document processing', () => {
  const source = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Application shell</title>
    <link rel="stylesheet" href="./app.css" />
    <script src="./app.js" defer></script>
  </head>
  <body><div id="root"></div></body>
</html>`

  it('indexes the source of an HTML shell stored as connector text', async () => {
    mockDownload.mockResolvedValue(Buffer.from(source))

    const result = await processDocument(
      '/api/files/serve/s3/kb%2Ffixture-index.html.txt?context=knowledge-base',
      'index.html',
      'text/plain'
    )

    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0].text).toContain('<script src="./app.js" defer></script>')
    expect(result.chunks[0].text).toContain('<div id="root"></div>')
    expect(result.metadata.characterCount).toBe(source.length)
  })

  it('keeps an actual HTML document on rendered-text extraction', async () => {
    mockDownload.mockResolvedValue(Buffer.from(source))

    await expect(
      processDocument(
        '/api/files/serve/s3/kb%2Ffixture-page.html?context=knowledge-base',
        'page.html',
        'text/html'
      )
    ).rejects.toMatchObject({ code: 'no_extractable_text' })
  })
})
