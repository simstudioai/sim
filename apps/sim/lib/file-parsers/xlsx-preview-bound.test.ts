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
      range?: { s: { r: number }; e: { r: number } }
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

    /**
     * `defval` made every cell in the range materialize, so allocation scaled
     * with columns x declared rows — and, because no row was left empty, it
     * silently defeated the `blankrows: false` sitting beside it.
     */
    expect(options.defval).toBeUndefined()
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
})
