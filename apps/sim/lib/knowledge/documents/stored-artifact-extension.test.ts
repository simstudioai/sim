/**
 * @vitest-environment node
 *
 * A knowledge base document's `filename` is a display name. For connector
 * documents it deliberately disagrees with the stored bytes — the sync engine
 * records `Report.pdf` while storing the text the connector already extracted
 * under a `.txt` key — so choosing a parser from the display name re-parsed
 * extracted text as the source binary. In production that failed 1,379
 * SharePoint PDFs with `Invalid PDF structure.` and silently double-wrapped
 * every spreadsheet, which "succeeded" because SheetJS accepts almost anything.
 */
import { describe, expect, it } from 'vitest'
import { resolveStoredArtifactExtension } from '@/lib/knowledge/documents/parser-extension'

const CONNECTOR_PDF_URL =
  '/api/files/serve/s3/kb%2F1786986883507-abc-Report.pdf.txt?context=knowledge-base'
const UPLOADED_PDF_URL =
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

  it('leaves an uploaded document on its real extension', () => {
    expect(resolveStoredArtifactExtension(UPLOADED_PDF_URL)).toBe('pdf')
  })

  it('handles the blob and gcs storage prefixes', () => {
    expect(resolveStoredArtifactExtension('/api/files/serve/blob/kb%2F1-a-x.docx')).toBe('docx')
    expect(resolveStoredArtifactExtension('/api/files/serve/gcs/kb%2F1-a-x.csv')).toBe('csv')
  })

  it('ignores URLs that are not served from our own storage', () => {
    expect(resolveStoredArtifactExtension('https://example.com/files/Report.pdf')).toBeUndefined()
    expect(resolveStoredArtifactExtension('data:application/pdf;base64,AAAA')).toBeUndefined()
  })

  /**
   * `fitStorageKeyName` drops the extension when it cannot fit, and a key may
   * carry no extension at all. Returning undefined puts the caller back on the
   * filename/MIME path rather than guessing.
   */
  it('returns undefined when the key carries no usable extension', () => {
    expect(resolveStoredArtifactExtension('/api/files/serve/s3/kb%2F1-a-Report')).toBeUndefined()
    expect(resolveStoredArtifactExtension('/api/files/serve/s3/kb%2F1-a-Report.')).toBeUndefined()
  })

  /**
   * Only ever redirects to a parser that exists — an unknown suffix falls back
   * instead of routing the document at a parser that cannot handle it.
   */
  it('returns undefined for an extension no parser claims', () => {
    expect(
      resolveStoredArtifactExtension('/api/files/serve/s3/kb%2F1-a-archive.zip')
    ).toBeUndefined()
    expect(
      resolveStoredArtifactExtension('/api/files/serve/s3/kb%2F1-a-Report.v2.final')
    ).toBeUndefined()
  })

  /**
   * The question is whether a parser can read the object, which the parser
   * registry answers — not whether we would accept it as an upload. The two lists
   * differ: macro-enabled, template and OpenDocument formats all parse but are not
   * in the upload allowlist, and gating on that list rejected every one of them.
   */
  it.each(['docm', 'dotx', 'xlsm', 'xlsb', 'xltx', 'pptm', 'potx', 'odt', 'ods', 'odp'])(
    'resolves %s, which parses but is not an accepted upload type',
    (extension) => {
      expect(resolveStoredArtifactExtension(`/api/files/serve/s3/kb%2F1-a-Book.${extension}`)).toBe(
        extension
      )
    }
  )

  it('is case-insensitive', () => {
    expect(resolveStoredArtifactExtension('/api/files/serve/s3/kb%2F1-a-Report.PDF')).toBe('pdf')
  })
})
