/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'

/**
 * A workbook holding three populated rows while declaring a range of 200,000 —
 * the shape Excel writes when stray formatting inflates `!ref`, and the shape
 * that exhausted an 8 GB worker.
 */
function inflatedRangeWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['header-a', 'header-b'],
    ['row-1-a', 'row-1-b'],
    ['row-2-a', 'row-2-b'],
  ])
  sheet['!ref'] = 'A1:B200000'
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('XlsxParser preview bound', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('converts only the preview window, not the declared range', async () => {
    const toJson = vi.spyOn(XLSX.utils, 'sheet_to_json')

    await new XlsxParser().parseBuffer(inflatedRangeWorkbook())

    expect(toJson).toHaveBeenCalled()
    const options = toJson.mock.calls[0][1] as {
      range?: { s: { r: number; c: number }; e: { r: number; c: number } }
      defval?: unknown
    }

    /**
     * The row cap used to be applied AFTER conversion, so it bounded the emitted
     * string while the allocation it was meant to bound had already happened.
     * Passing the window into the conversion is what makes the cap real.
     */
    expect(options.range).toBeDefined()
    const rowsRequested =
      (options.range as { s: { r: number }; e: { r: number } }).e.r -
      (options.range as { s: { r: number }; e: { r: number } }).s.r +
      1
    expect(rowsRequested).toBeLessThanOrEqual(1000)
    const columnsRequested =
      (options.range as { s: { c: number }; e: { c: number } }).e.c -
      (options.range as { s: { c: number }; e: { c: number } }).s.c +
      1
    expect(columnsRequested).toBeLessThanOrEqual(256)

    /**
     * `defval` made every cell in the range materialize, so allocation scaled
     * with columns x declared rows — and, because no row was left empty, it
     * silently defeated the `blankrows: false` sitting beside it.
     */
    expect(options.defval).toBeUndefined()
  })

  it('caps a sheet with an inflated declared column range before conversion', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['header'], ['value']])
    sheet['!ref'] = 'A1:XFD2'
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Wide')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const toJson = vi.spyOn(XLSX.utils, 'sheet_to_json')

    const result = await new XlsxParser().parseBuffer(buffer)
    const options = toJson.mock.calls[0][1] as {
      range: { s: { c: number }; e: { c: number } }
    }

    expect(options.range.e.c - options.range.s.c + 1).toBe(256)
    expect(result.metadata?.truncated).toBe(true)
    expect(result.content).toContain('16,384 total columns')
  })

  it('hard-caps rendered content and bounds sampled metadata independently', async () => {
    const repeatedCell = 'x'.repeat(500)
    const rows = Array.from({ length: 100 }, () => Array.from({ length: 256 }, () => repeatedCell))
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Dense')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await new XlsxParser().parseBuffer(buffer)
    const sampledData = result.metadata?.sampledData as string[][]
    const sampledCharacters = sampledData.flat().reduce((sum, value) => sum + value.length, 0)

    expect(result.metadata?.contentSize).toBeLessThanOrEqual(10 * 1024 * 1024)
    expect(result.content.length).toBeLessThan(10 * 1024 * 1024 + 200)
    expect(sampledData.every((row) => row.length <= 32)).toBe(true)
    expect(sampledData.flat().every((value) => value.length <= 256)).toBe(true)
    expect(sampledCharacters).toBe(100 * 32 * 256)
  })

  it('still reports the workbook the sheet declares', async () => {
    const result = await new XlsxParser().parseBuffer(inflatedRangeWorkbook())

    // Bounding the conversion must not change what the metadata claims the
    // workbook holds, only how much of it is materialized to say so.
    expect(result.metadata?.totalRows).toBe(200000)
    expect(result.content).toContain('header-a')
    expect(result.content).toContain('row-2-b')
  })

  it('still reports truncation for a sheet larger than the preview window', async () => {
    const result = await new XlsxParser().parseBuffer(inflatedRangeWorkbook())

    /**
     * Bounding the conversion made the converted length equal the window, so
     * comparing it against the window could never be true — the notice silently
     * disappeared from exactly the large sheets it exists for.
     */
    expect(result.metadata?.truncated).toBe(true)
    expect(result.content).toContain('200,000 total rows')
  })

  /**
   * A sheet whose declared range fits inside the window was not cut short, even
   * though blank rows mean fewer rows survive conversion than the range names.
   * Comparing the declared count against the converted length reported those as
   * truncated.
   */
  it('does not report truncation for a small sheet containing blank rows', async () => {
    // A genuinely empty row — empty strings are still cells and are not skipped.
    const sheet = XLSX.utils.aoa_to_sheet([['header-a', 'header-b'], [], ['row-2-a', 'row-2-b']])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await new XlsxParser().parseBuffer(buffer)

    expect(result.metadata?.truncated).toBe(false)
    expect(result.content).not.toContain('total rows, showing first')
  })

  it('preserves a long cell in full when the aggregate output remains within budget', async () => {
    const longCell = 'x'.repeat(2_000)
    const sheet = XLSX.utils.aoa_to_sheet([['header'], [longCell]])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Long cell')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await new XlsxParser().parseBuffer(buffer)

    expect(result.metadata?.truncated).toBe(false)
    expect(result.content).toContain(longCell)
  })

  it.each(['', '   '])(
    'does not treat an empty-string cell as extractable content',
    async (cell) => {
      const sheet = XLSX.utils.aoa_to_sheet([[cell]])
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Empty')
      const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      const result = await new XlsxParser().parseBuffer(buffer)

      expect(result.metadata?.degraded).toBe(true)
    }
  )

  it('measures the rendered content cap in UTF-8 bytes', async () => {
    const rows = Array.from({ length: 50 }, () =>
      Array.from({ length: 256 }, () => '🚀'.repeat(300))
    )
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Unicode')
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await new XlsxParser().parseBuffer(buffer)

    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(10 * 1024 * 1024)
    expect(result.content).toContain('Content truncated due to size limits')
  })
})
