import { Readable } from 'node:stream'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
import { getCsvPreviewSlice } from '@/lib/file-parsers/csv-preview-slice'

const mockDownloadFileStream = storageServiceMockFns.mockDownloadFileStream

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

  it('destroys a source acquired after the request was already aborted', async () => {
    const source = streamOf('a,b\n1,2\n')
    const destroySpy = vi.spyOn(source, 'destroy')
    const controller = new AbortController()
    controller.abort()
    mockDownloadFileStream.mockResolvedValue(source)

    await expect(getCsvPreviewSlice({ ...args, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(destroySpy).toHaveBeenCalled()
  })

  it('destroys an active source when the request is aborted', async () => {
    const read = vi.fn()
    const source = new Readable({ read })
    const destroySpy = vi.spyOn(source, 'destroy')
    const controller = new AbortController()
    mockDownloadFileStream.mockResolvedValue(source)

    const preview = getCsvPreviewSlice({ ...args, signal: controller.signal })
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    controller.abort()

    await expect(preview).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroySpy).toHaveBeenCalled()
  })
})

it('ends at an oversized streamed record with the rows before it, without consuming the file', async () => {
  let chunksRead = 0
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('header\nfirst\n"')
      for (let i = 0; i < 1000; i++) {
        chunksRead++
        yield Buffer.alloc(16 * 1024, 'x')
      }
    })()
  )
  mockDownloadFileStream.mockResolvedValue(source)
  await expect(getCsvPreviewSlice(args)).resolves.toEqual({
    headers: ['header'],
    rows: [['first']],
    truncated: true,
  })
  expect(chunksRead).toBeLessThan(30)
  expect(source.destroyed).toBe(true)
})

it('bounds bytes consumed even when blank records produce no preview rows', async () => {
  let chunksRead = 0
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('header\n')
      for (let i = 0; i < 1000; i++) {
        chunksRead++
        yield Buffer.alloc(64 * 1024, '\n')
      }
    })()
  )
  mockDownloadFileStream.mockResolvedValue(source)
  await expect(getCsvPreviewSlice(args)).resolves.toEqual({
    headers: ['header'],
    rows: [],
    truncated: true,
  })
  expect(chunksRead).toBeLessThan(140)
  expect(source.destroyed).toBe(true)
})

it('returns the leading rows of a file whose rows exhaust the byte budget before the row cap', async () => {
  const wide = 'x'.repeat(10 * 1024)
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('id,payload\n')
      for (let i = 0; i < CSV_PREVIEW_MAX_ROWS + 100; i++) yield Buffer.from(`${i},${wide}\n`)
    })()
  )
  mockDownloadFileStream.mockResolvedValue(source)
  const slice = await getCsvPreviewSlice(args)
  expect(slice.truncated).toBe(true)
  expect(slice.headers).toEqual(['id', 'payload'])
  expect(slice.rows.length).toBeGreaterThan(0)
  expect(slice.rows.length).toBeLessThan(CSV_PREVIEW_MAX_ROWS)
  expect(slice.rows.map(([id]) => id)).toEqual(slice.rows.map((_, index) => String(index)))
})

it.each([
  ['a quote followed by other characters', 'a,b\n1,2\n"x"y,3\n'],
  ['a quote left open at the end of the file', 'a,b\n1,2\n"open,3'],
])('skips a malformed record with %s instead of failing the preview', async (_, text) => {
  mockDownloadFileStream.mockResolvedValue(streamOf(text))
  await expect(getCsvPreviewSlice(args)).resolves.toEqual({
    headers: ['a', 'b'],
    rows: [['1', '2']],
    truncated: false,
  })
})
