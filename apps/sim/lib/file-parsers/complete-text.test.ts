import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { CompleteTextBuilder } from '@/lib/file-parsers/complete-text'
import { CsvParser } from '@/lib/file-parsers/csv-parser'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'

describe('complete extraction for search', () => {
  it('counts UTF-8 bytes before retaining output', () => {
    const text = new CompleteTextBuilder(8)
    text.append('🙂🙂')
    expect(() => text.append('a')).toThrow('byte budget')
    expect(text.finish()).toBe('🙂🙂')
  })
  it('preserves CSV rows after the preview boundary and duplicate columns', async () => {
    const text = `name,name\n${'first,second\n'.repeat(1001)}last,tail\n`
    const result = await new CsvParser().parseBuffer(Buffer.from(text), {
      contentMode: 'complete',
      maxTextBytes: 25000,
    })
    expect(result.content).toContain('last,tail')
    expect(result.content).toContain('first,second')
    expect(result.metadata?.truncated).toBe(false)
    expect(result.content.split('\n')).toHaveLength(1004)
  })
  it('rejects CSV output instead of returning a prefix', async () => {
    await expect(
      new CsvParser().parseBuffer(Buffer.from('a,b\nc,d'), {
        contentMode: 'complete',
        maxTextBytes: 6,
      })
    ).rejects.toThrow('byte budget')
  })
  it('cancels complete CSV extraction', async () => {
    await expect(
      new CsvParser().parseBuffer(Buffer.from('a,b'), {
        contentMode: 'complete',
        signal: AbortSignal.abort(),
      })
    ).rejects.toThrow()
  })
  it.each([
    ['csv', new CsvParser()],
    ['xlsx', new XlsxParser()],
  ] as const)('cancels %s file reads before parsing', async (extension, parser) => {
    const dir = await mkdtemp(join(tmpdir(), 'parser-cancel-'))
    const file = join(dir, `test.${extension}`)
    try {
      await writeFile(file, 'content')
      await expect(
        parser.parseFile(file, {
          contentMode: 'complete',
          signal: AbortSignal.abort(),
        })
      ).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('preserves cancellation before inspecting a spreadsheet buffer', async () => {
    const reason = new Error('Cancelled by caller')
    await expect(
      new XlsxParser().parseBuffer(Buffer.from('invalid workbook'), {
        contentMode: 'complete',
        signal: AbortSignal.abort(reason),
      })
    ).rejects.toBe(reason)
  })
  it.each([1, 2])('preserves cancellation while extracting a %i-row spreadsheet', async (rows) => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['first'], ['second']].slice(0, rows)),
      'Data'
    )
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const controller = new AbortController()
    const reason = new Error('Cancelled during extraction')
    const formatCell = XLSX.utils.format_cell
    const format = vi.spyOn(XLSX.utils, 'format_cell').mockImplementationOnce((...args) => {
      controller.abort(reason)
      return formatCell(...args)
    })
    try {
      await expect(
        new XlsxParser().parseBuffer(buffer, {
          contentMode: 'complete',
          signal: controller.signal,
        })
      ).rejects.toBe(reason)
    } finally {
      format.mockRestore()
    }
  })
  it('marks a workbook with only whitespace as degraded in complete mode', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([[' ', '\t']]),
      'Searchable name'
    )
    const result = await new XlsxParser().parseBuffer(
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      { contentMode: 'complete' }
    )
    expect(result.metadata).toMatchObject({ rowCount: 0, degraded: true, truncated: false })
  })
  it('reads sparse spreadsheet cells beyond both preview limits without expanding the rectangle', async () => {
    const sheet: XLSX.WorkSheet = {
      A1: { t: 's', v: 'header' },
      ZZ1001: { t: 's', v: 'tail needle' },
      '!ref': 'A1:ZZ1001',
    }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Data')
    const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:XFD1048576"/>')
    )
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const result = await new XlsxParser().parseBuffer(buffer, {
      contentMode: 'complete',
      maxTextBytes: 25000,
    })
    expect(result.content).toContain('tail needle')
    expect(result.metadata?.truncated).toBe(false)
    expect(result.content.length).toBeLessThan(25000)
  })
  it('stops a shared-string row before materializing every expanded cell', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([Array(20).fill('x'.repeat(20000))]),
      'Data'
    )
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true })
    const format = vi.spyOn(XLSX.utils, 'format_cell')
    try {
      await expect(
        new XlsxParser().parseBuffer(buffer, { contentMode: 'complete', maxTextBytes: 50000 })
      ).rejects.toThrow('byte budget')
      expect(format.mock.calls.length).toBeLessThan(20)
    } finally {
      format.mockRestore()
    }
  })
  it('rejects spreadsheet output exceeding the caller byte budget', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['hello', 'world']]), 'Data')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    await expect(
      new XlsxParser().parseBuffer(buffer, { contentMode: 'complete', maxTextBytes: 10 })
    ).rejects.toThrow('byte budget')
  })
})
