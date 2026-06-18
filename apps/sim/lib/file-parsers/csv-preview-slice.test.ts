/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFileStream } = vi.hoisted(() => ({
  mockDownloadFileStream: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mockDownloadFileStream,
}))

import { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'

function streamOf(text: string): Readable {
  // Array-wrapped so the whole text is one chunk (a bare Buffer/string is iterated element-wise).
  return Readable.from([Buffer.from(text, 'utf-8')])
}

const args = { key: 'workspace/ws_1/file.csv', context: 'workspace' as const }

function csvWithRows(dataRows: number): string {
  const lines = ['h1,h2']
  for (let i = 0; i < dataRows; i++) lines.push(`${i},x`)
  return lines.join('\n')
}

describe('getCsvPreviewSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns headers and every row when under the cap', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf('a,b\n1,2\n3,4\n'))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.headers).toEqual(['a', 'b'])
    expect(slice.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
    expect(slice.truncated).toBe(false)
  })

  it('caps at CSV_PREVIEW_MAX_ROWS and flags truncated', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf(csvWithRows(CSV_PREVIEW_MAX_ROWS + 500)))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.rows).toHaveLength(CSV_PREVIEW_MAX_ROWS)
    expect(slice.truncated).toBe(true)
  })

  it('is not truncated at exactly the cap', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf(csvWithRows(CSV_PREVIEW_MAX_ROWS)))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.rows).toHaveLength(CSV_PREVIEW_MAX_ROWS)
    expect(slice.truncated).toBe(false)
  })

  it('detects a semicolon delimiter', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf('a;b;c\n1;2;3\n'))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.headers).toEqual(['a', 'b', 'c'])
    expect(slice.rows).toEqual([['1', '2', '3']])
  })

  it('detects a tab delimiter', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf('a\tb\n1\t2\n'))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.headers).toEqual(['a', 'b'])
    expect(slice.rows).toEqual([['1', '2']])
  })

  it('returns empty for an empty file', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf(''))
    const slice = await getCsvPreviewSlice(args)
    expect(slice).toEqual({ headers: [], rows: [], truncated: false })
  })

  it('tolerates ragged rows', async () => {
    mockDownloadFileStream.mockResolvedValue(streamOf('a,b,c\n1,2\n4,5,6,7\n'))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.headers).toEqual(['a', 'b', 'c'])
    expect(slice.rows[0]).toEqual(['1', '2'])
  })

  it('truncates an oversized cell', async () => {
    const big = 'x'.repeat(3000)
    mockDownloadFileStream.mockResolvedValue(streamOf(`a\n${big}\n`))
    const slice = await getCsvPreviewSlice(args)
    expect(slice.rows[0][0].length).toBeLessThan(3000)
  })

  it('destroys the source stream after reading the slice', async () => {
    const source = streamOf(csvWithRows(CSV_PREVIEW_MAX_ROWS + 50))
    const destroySpy = vi.spyOn(source, 'destroy')
    mockDownloadFileStream.mockResolvedValue(source)
    const slice = await getCsvPreviewSlice(args)
    expect(slice.truncated).toBe(true)
    expect(destroySpy).toHaveBeenCalled()
  })
})
