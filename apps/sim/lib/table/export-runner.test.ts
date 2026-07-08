/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetTableById,
  mockSelectExportRowPage,
  mockUpdateJobProgress,
  mockMarkJobReady,
  mockMarkJobFailed,
  mockSetJobResultKey,
  mockAppendTableEvent,
  mockCreateMultipartUpload,
  mockDeleteFile,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockSelectExportRowPage: vi.fn(),
  mockUpdateJobProgress: vi.fn(),
  mockMarkJobReady: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockSetJobResultKey: vi.fn(),
  mockAppendTableEvent: vi.fn(),
  mockCreateMultipartUpload: vi.fn(),
  mockDeleteFile: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))
vi.mock('@/lib/table/jobs/service', () => ({
  selectExportRowPage: mockSelectExportRowPage,
  updateJobProgress: mockUpdateJobProgress,
  markJobReady: mockMarkJobReady,
  markJobFailed: mockMarkJobFailed,
  setJobResultKey: mockSetJobResultKey,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  createMultipartUpload: mockCreateMultipartUpload,
  deleteFile: mockDeleteFile,
}))

import { runTableExport } from '@/lib/table/export-runner'

const table = {
  id: 'tbl_1',
  name: 'People',
  workspaceId: 'ws_1',
  schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
}

const payload = { jobId: 'job_1', tableId: 'tbl_1', workspaceId: 'ws_1', format: 'csv' as const }

interface FakeHandle {
  key: string
  content: string
  write: ReturnType<typeof vi.fn>
  complete: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

let lastHandle: FakeHandle | null

describe('runTableExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastHandle = null
    mockGetTableById.mockResolvedValue(table)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockMarkJobReady.mockResolvedValue(true)
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockSetJobResultKey.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
    // A handle that records every write so tests can assert the streamed bytes, and echoes the
    // pinned key back from `complete` like the real uploader does.
    mockCreateMultipartUpload.mockImplementation(({ key }: { key: string }) => {
      const chunks: string[] = []
      const handle: FakeHandle = {
        key,
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
    mockSelectExportRowPage.mockResolvedValue([
      { id: 'r1', data: { col_name: 'Ada' }, orderKey: 'a0' },
    ])
  })

  it('streams rows to the uploader, stamps the result key, and marks ready', async () => {
    await runTableExport(payload)

    expect(mockCreateMultipartUpload).toHaveBeenCalledTimes(1)
    const init = mockCreateMultipartUpload.mock.calls[0][0]
    expect(init.key).toBe('workspace/ws_1/exports/tbl_1/job_1/People.csv')
    expect(init.context).toBe('workspace')
    expect(init.contentType).toContain('text/csv')

    expect(lastHandle?.content).toBe('name\nAda\n')
    expect(lastHandle?.complete).toHaveBeenCalledTimes(1)
    expect(lastHandle?.abort).not.toHaveBeenCalled()

    expect(mockSetJobResultKey).toHaveBeenCalledWith('tbl_1', 'job_1', init.key)
    expect(mockMarkJobReady).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'export', status: 'ready', progress: 1 })
    )
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('serializes JSON exports with display-name keys', async () => {
    await runTableExport({ ...payload, format: 'json' })
    const init = mockCreateMultipartUpload.mock.calls[0][0]
    expect(init.key.endsWith('/People.json')).toBe(true)
    expect(JSON.parse(lastHandle?.content ?? '')).toEqual([{ name: 'Ada' }])
  })

  it('aborts the upload and never completes when ownership is lost (cancel)', async () => {
    mockUpdateJobProgress.mockResolvedValue(false)

    await runTableExport(payload)

    expect(lastHandle?.complete).not.toHaveBeenCalled()
    expect(lastHandle?.abort).toHaveBeenCalledTimes(1)
    expect(mockMarkJobReady).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('aborts before completing when ownership is lost at the finalize gate', async () => {
    mockUpdateJobProgress.mockResolvedValueOnce(true).mockResolvedValue(false)

    await runTableExport(payload)

    expect(mockSelectExportRowPage).toHaveBeenCalledTimes(1)
    expect(lastHandle?.complete).not.toHaveBeenCalled()
    expect(lastHandle?.abort).toHaveBeenCalledTimes(1)
    expect(mockMarkJobReady).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('deletes the finalized object when the job was canceled at the wire', async () => {
    mockMarkJobReady.mockResolvedValue(false)

    await runTableExport(payload)

    expect(lastHandle?.complete).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining('exports/tbl_1/job_1') })
    )
    expect(mockAppendTableEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' })
    )
  })

  it('aborts the upload, marks the job failed, and emits a failed event on error', async () => {
    mockSelectExportRowPage.mockRejectedValue(new Error('boom'))

    await runTableExport(payload)

    expect(lastHandle?.abort).toHaveBeenCalledTimes(1)
    expect(mockMarkJobFailed).toHaveBeenCalledWith('tbl_1', 'job_1', 'boom')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'export', status: 'failed', error: 'boom' })
    )
  })
})
