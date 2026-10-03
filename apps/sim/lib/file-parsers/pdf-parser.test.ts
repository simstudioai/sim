import { deflateSync } from 'zlib'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { MAX_PDF_TEXT_CHARS, PdfParser } from '@/lib/file-parsers/pdf-parser'
import type { FileParseResult } from '@/lib/file-parsers/types'

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
function _buildTextFreePdf(pageCount: number): Buffer {
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
function _buildLargeTypesetPdf(pageCount: number): Buffer {
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

/** Repeats needed to exceed `MAX_PDF_TEXT_CHARS`; 64 characters per repeat. */
const BOMB_REPEATS = 200_000

/** Evaluating the bomb takes pdf.js about two minutes; both bomb tests share one parse. */
const BOMB_TIMEOUT_MS = 300_000

let bombParse: Promise<FileParseResult> | undefined

function parseBomb(): Promise<FileParseResult> {
  bombParse ??= new PdfParser().parseBuffer(buildTextBombPdf(BOMB_REPEATS))
  return bombParse
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/** Day numbers of `month` (0-based) in 2026, one array per calendar week. */
function calendarWeeks(month: number): string[][] {
  const firstWeekday = new Date(Date.UTC(2026, month, 1)).getUTCDay()
  const days = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate()
  const weeks: string[][] = [[]]
  for (let day = 1; day <= days; day++) {
    if (weeks[weeks.length - 1].length > 0 && (firstWeekday + day - 1) % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push(String(day))
  }
  return weeks
}

/**
 * A quarter of 2026 laid out as three month grids side by side, drawn the way
 * calendar producers draw them: each visual row across all three months before
 * the next row.
 */
async function _buildQuarterCalendarPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  const size = 8
  const cell = 20
  const monthX = [40, 220, 400]
  const names = ['January 2026', 'February 2026', 'March 2026']
  page.drawText('2026 Calendar', { x: 220, y: 740, size: 14, font })
  for (let row = 0; row < 8; row++) {
    const y = 700 - row * 14
    for (const [month, x] of monthX.entries()) {
      if (row === 0) page.drawText(names[month], { x, y, size, font })
      if (row === 1) {
        WEEKDAYS.forEach((day, i) => page.drawText(day, { x: x + i * cell, y, size, font }))
      }
      if (row < 2) continue
      const weeks = calendarWeeks(month)
      const week = weeks[row - 2]
      if (!week) continue
      const offset = row === 2 ? 7 - week.length : 0
      week.forEach((day, i) => page.drawText(day, { x: x + (offset + i) * cell, y, size, font }))
    }
  }
  return Buffer.from(await doc.save())
}

describe('PdfParser', () => {
  it(
    'bounds extracted text from a compression-bomb PDF instead of exhausting the heap',
    async () => {
      const bomb = buildTextBombPdf(BOMB_REPEATS)
      expect(bomb.length).toBeLessThan(200 * 1024)

      const result = await parseBomb()

      expect(result.metadata?.truncated).toBe(true)
      expect(result.metadata?.warning).toMatch(/parser limit/i)
      expect(result.content.length).toBeLessThanOrEqual(MAX_PDF_TEXT_CHARS + 200)
    },
    BOMB_TIMEOUT_MS
  )

  it(
    'marks truncated content inline so callers reading only content can see it',
    async () => {
      const result = await parseBomb()

      expect(result.content).toMatch(/\[\.\.\. PDF text truncated at parser limits.* \.\.\.\]/)
    },
    BOMB_TIMEOUT_MS
  )

  it('rejects a real compressed page at its independent complete-extraction cap', async () => {
    await expect(
      new PdfParser().parseBuffer(buildTextBombPdf(6000), { pdfTextMode: 'complete' })
    ).rejects.toMatchObject({ name: 'FileParserError', code: 'complexity_limit' })
  }, 30_000)

  it('rejects malformed PDF input', async () => {
    await expect(new PdfParser().parseBuffer(Buffer.from('%PDF-1.4\nnot a PDF'))).rejects.toThrow(
      /Invalid PDF|PDF structure|document/i
    )
  })

  it('preserves the password-required error for encrypted PDFs', async () => {
    await expect(new PdfParser().parseBuffer(buildEncryptedPdf())).rejects.toMatchObject({
      name: 'FileParserError',
      code: 'encrypted_file',
    })
  })
})
