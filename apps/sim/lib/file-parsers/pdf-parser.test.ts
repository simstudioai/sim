/**
 * @vitest-environment node
 */
import { deflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { MAX_PDF_TEXT_CHARS, PdfParser } from '@/lib/file-parsers/pdf-parser'
import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'

/**
 * Builds a single-page PDF that draws 64 characters per repeat from a
 * FlateDecode content stream, so a few dozen kilobytes of input yields millions
 * of extracted characters — what made the unbounded extractor exhaust the heap
 * and abort the process.
 *
 * Hand-assembled rather than built with `pdf-lib` because the fixture's whole
 * point is the compression ratio of the content stream, which `pdf-lib` gives
 * no way to control.
 */
function buildTextBombPdf(repeats: number): Buffer {
  const unit = `BT /F1 12 Tf 10 700 Td (${'A'.repeat(64)}) Tj ET\n`
  const compressed = deflateSync(Buffer.from(unit.repeat(repeats)))

  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]

  return assemblePdf(objects)
}

/** Builds a PDF whose pages carry no content stream, so nothing is extractable. */
function buildTextFreePdf(pageCount: number): Buffer {
  const pageIds = Array.from({ length: pageCount }, (_, i) => 3 + i)

  return assemblePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
    ),
    ...pageIds.map(() => Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')),
  ])
}

/** Shares a bounded dense text stream across pages to exercise aggregate extraction. */
function buildLargeTypesetPdf(pageCount: number): Buffer {
  const unit = `BT /F1 12 Tf 10 700 Td (${'A'.repeat(64)}) Tj ET\n`
  const compressed = deflateSync(Buffer.from(unit.repeat(3000)))
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 5)
  return assemblePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    ...pageIds.map(() =>
      Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R /Resources << /Font << /F1 4 0 R >> >> >>'
      )
    ),
  ])
}

/** Builds a structurally valid PDF that requires a password before opening. */
function buildEncryptedPdf(): Buffer {
  const ownerAndUserKey = '00'.repeat(32)
  const documentId = '11'.repeat(16)

  return assemblePdf(
    [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'),
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /O <${ownerAndUserKey}> /U <${ownerAndUserKey}> /P -4 >>`
      ),
    ],
    `/Encrypt 4 0 R /ID [<${documentId}> <${documentId}>]`
  )
}

/** Serializes numbered objects into a PDF with a matching xref table and trailer. */
function assemblePdf(objects: Buffer[], trailerEntries = ''): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  const offsets: number[] = []
  let offset = chunks[0].length

  objects.forEach((object, index) => {
    offsets.push(offset)
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ])
    chunks.push(chunk)
    offset += chunk.length
  })

  const xrefRows = offsets
    .map((value) => `${value.toString().padStart(10, '0')} 00000 n \n`)
    .join('')
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}` +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerEntries} >>\nstartxref\n${offset}\n%%EOF\n`
    )
  )

  return Buffer.concat(chunks)
}

describe('PdfParser', () => {
  it('preloads the server worker instead of relying on a runtime-relative worker path', async () => {
    const previousWorker: unknown = Reflect.get(globalThis, 'pdfjsWorker')
    Reflect.deleteProperty(globalThis, 'pdfjsWorker')

    const pdf = await openPdfDocument(new Uint8Array(buildTextFreePdf(1)))

    try {
      expect(Reflect.get(globalThis, 'pdfjsWorker')).toEqual({
        WorkerMessageHandler: expect.anything(),
      })
      expect(pdf.numPages).toBe(1)
    } finally {
      await pdf.destroy()
      if (previousWorker === undefined) {
        Reflect.deleteProperty(globalThis, 'pdfjsWorker')
      } else {
        Reflect.set(globalThis, 'pdfjsWorker', previousWorker)
      }
    }
  })

  it('bounds extracted text from a compression-bomb PDF instead of exhausting the heap', async () => {
    const bomb = buildTextBombPdf(200_000)
    expect(bomb.length).toBeLessThan(200 * 1024)

    const result = await new PdfParser().parseBuffer(bomb)

    expect(result.metadata?.truncated).toBe(true)
    expect(result.metadata?.warning).toMatch(/parser limit/i)
    expect(result.content.length).toBeLessThanOrEqual(MAX_PDF_TEXT_CHARS + 200)
  }, 120_000)

  it('marks truncated content inline so callers reading only content can see it', async () => {
    const result = await new PdfParser().parseBuffer(buildTextBombPdf(200_000))

    expect(result.content).toMatch(/\[\.\.\. PDF text truncated at parser limits.* \.\.\.\]/)
  }, 120_000)

  it('extracts a real multi-page PDF past the preview budget completely', async () => {
    const result = await new PdfParser().parseBuffer(buildLargeTypesetPdf(60), {
      pdfTextMode: 'complete',
    })

    expect(result.content.length).toBeGreaterThan(MAX_PDF_TEXT_CHARS)
    expect(result.metadata).toMatchObject({ pageCount: 60, truncated: false })
    expect(result.content).not.toContain('truncated')
  }, 60_000)

  it('rejects a real compressed page at its independent complete-extraction cap', async () => {
    await expect(
      new PdfParser().parseBuffer(buildTextBombPdf(6000), { pdfTextMode: 'complete' })
    ).rejects.toMatchObject({ name: 'FileParserError', code: 'complexity_limit' })
  }, 30_000)

  it('extracts a small PDF in full and does not flag it as truncated', async () => {
    const result = await new PdfParser().parseBuffer(buildTextBombPdf(3))

    expect(result.metadata?.truncated).toBe(false)
    expect(result.metadata?.warning).toBeUndefined()
    expect(result.metadata?.pageCount).toBe(1)
    expect(result.metadata?.source).toBe('unpdf')
    expect(result.content).toContain('AAAA')
    expect(result.content).not.toContain('truncated')
  }, 30_000)

  it('reports a multi-page PDF with no extractable text as empty', async () => {
    const result = await new PdfParser().parseBuffer(buildTextFreePdf(3))

    expect(result.content.trim()).toBe('')
    expect(result.content).not.toContain('[...')
  }, 30_000)

  it('rejects malformed PDF input', async () => {
    await expect(new PdfParser().parseBuffer(Buffer.from('%PDF-1.4\nnot a PDF'))).rejects.toThrow(
      /Invalid PDF|PDF structure|document/i
    )
  })

  it('preserves the password-required error for encrypted PDFs', async () => {
    await expect(new PdfParser().parseBuffer(buildEncryptedPdf())).rejects.toMatchObject({
      name: 'PasswordException',
    })
  })
})
