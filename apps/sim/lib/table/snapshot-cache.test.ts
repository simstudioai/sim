import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  tableJobsServiceMock,
  tableJobsServiceMockFns,
} from '@sim/testing/mocks/table-jobs-service.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { getOrCreateTableSnapshot, TableSnapshotTooLargeError } from '@/lib/table/snapshot-cache'

const mockSelectExportRowPage = tableJobsServiceMockFns.mockSelectExportRowPage

const { mockCreateMultipartUpload, mockHeadObject, mockDeleteFile } = storageServiceMockFns

const table = {
  id: 'tbl_1',
  workspaceId: 'ws_1',
  schema: {
    columns: [
      { id: 'col_name', name: 'name', type: 'string' },
      {
        id: 'col_status',
        name: 'status',
        type: 'select',
        options: [{ id: 'opt_open', name: 'Open' }],
      },
    ],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

let lastHandle: {
  content: string
  complete: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
} | null

/** Queue the values successive `readRowsVersion` calls return. */
function versions(...values: number[]) {
  for (const v of values) queueTableRows(schemaMock.userTableDefinitions, [{ rowsVersion: v }])
}

describe('getOrCreateTableSnapshot', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    resetDbChainMock()
    lastHandle = null
    mockDeleteFile.mockResolvedValue(undefined)
    mockSelectExportRowPage.mockResolvedValueOnce([
      { id: 'r1', data: { col_name: 'Ada', col_status: 'opt_open' }, orderKey: 'a0' },
    ])
    mockSelectExportRowPage.mockResolvedValue([])
    mockCreateMultipartUpload.mockImplementation(({ key }: { key: string }) => {
      const chunks: string[] = []
      const handle = {
        content: '',
        write: vi.fn((chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
          return Promise.resolve()
        }),
        complete: vi.fn(() => {
          handle.content = chunks.join('')
          return Promise.resolve({ key, size: Buffer.byteLength(handle.content) })
        }),
        abort: vi.fn(() => Promise.resolve()),
      }
      lastHandle = handle
      return Promise.resolve(handle)
    })
  })

  it('materializes and stores on a miss, then cleans up the previous version', async () => {
    versions(3, 3) // initial read, then unchanged recheck
    mockHeadObject.mockResolvedValue(null)

    const ref = await getOrCreateTableSnapshot(table, 'req')

    expect(mockCreateMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^table-snapshots\/ws_1\/tbl_1\/v3-[0-9a-f]{12}\.csv$/),
        context: 'execution',
        completionPolicy: 'reuse-existing',
      })
    )
    // Select cells materialize as the option name, not the stored id.
    expect(lastHandle?.content).toBe('name,status\nAda,Open\n')
    expect(ref).toEqual({
      key: expect.stringMatching(/^table-snapshots\/ws_1\/tbl_1\/v3-[0-9a-f]{12}\.csv$/),
      size: Buffer.byteLength('name,status\nAda,Open\n'),
      version: 3,
    })
    // Best-effort prune of v2.
    expect(mockDeleteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^table-snapshots\/ws_1\/tbl_1\/v2-[0-9a-f]{12}\.csv$/),
        context: 'execution',
      })
    )
  })

  it('keys the snapshot by tenant — the same table id in another workspace gets a different key', async () => {
    versions(1)
    mockHeadObject.mockResolvedValue({ size: 1 })
    const ref = await getOrCreateTableSnapshot({ ...table, workspaceId: 'ws_2' }, 'req')
    expect(ref.key).toMatch(/^table-snapshots\/ws_2\/tbl_1\/v1-[0-9a-f]{12}\.csv$/)
  })

  it('changes the key when the column shape changes (schema edits invalidate the cache)', async () => {
    versions(7, 7)
    mockHeadObject.mockResolvedValue({ size: 1 })

    const a = await getOrCreateTableSnapshot(table, 'req')
    const b = await getOrCreateTableSnapshot(
      {
        ...table,
        schema: { columns: [{ id: 'col_name', name: 'renamed', type: 'string' }] },
      } as never,
      'req'
    )

    // Same workspace/table/row-version, but a renamed column flips the shape hash → different key.
    expect(a.key).not.toBe(b.key)
    expect(a.key).toMatch(/\/v7-[0-9a-f]{12}\.csv$/)
    expect(b.key).toMatch(/\/v7-[0-9a-f]{12}\.csv$/)
  })

  it('re-keys and rebuilds when rows_version advances mid-scan', async () => {
    versions(3, 4) // read v3, materialize, recheck sees v4
    mockHeadObject.mockResolvedValueOnce(null) // v3 miss
    mockHeadObject.mockResolvedValueOnce(null) // v4 miss → rebuild
    // second materialize needs its own page sequence
    mockSelectExportRowPage.mockReset()
    mockSelectExportRowPage
      .mockResolvedValueOnce([
        { id: 'r1', data: { col_name: 'Ada', col_status: 'opt_open' }, orderKey: 'a0' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'r1', data: { col_name: 'Ada', col_status: 'opt_open' }, orderKey: 'a0' },
      ])
      .mockResolvedValueOnce([])

    const ref = await getOrCreateTableSnapshot(table, 'req')

    expect(ref.version).toBe(4)
    expect(ref.key).toMatch(/^table-snapshots\/ws_1\/tbl_1\/v4-[0-9a-f]{12}\.csv$/)
    expect(mockCreateMultipartUpload).toHaveBeenCalledTimes(2)
    // the stale v3 object is dropped
    expect(mockDeleteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^table-snapshots\/ws_1\/tbl_1\/v3-[0-9a-f]{12}\.csv$/),
      })
    )
  })

  it('aborts and throws when the CSV exceeds the size cap', async () => {
    versions(1)
    mockHeadObject.mockResolvedValue(null)
    mockSelectExportRowPage.mockReset()
    // A full batch of wide rows on every page → the materialize loop keeps paging until the running
    // byte count crosses the cap, then aborts. Peak memory stays at one page (~MBs), not the cap.
    const wideRow = { id: 'r', data: { col_name: 'x'.repeat(1000) }, orderKey: 'a0' }
    const fullPage = Array.from({ length: 10000 }, () => wideRow)
    mockSelectExportRowPage.mockResolvedValue(fullPage)

    await expect(getOrCreateTableSnapshot(table, 'req')).rejects.toBeInstanceOf(
      TableSnapshotTooLargeError
    )
    expect(lastHandle?.abort).toHaveBeenCalledTimes(1)
    expect(lastHandle?.complete).not.toHaveBeenCalled()
  })
})
