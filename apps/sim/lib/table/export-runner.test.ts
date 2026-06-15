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
  mockUploadFile,
  mockDeleteFile,
} = vi.hoisted(() => ({
  mockGetTableById: vi.fn(),
  mockSelectExportRowPage: vi.fn(),
  mockUpdateJobProgress: vi.fn(),
  mockMarkJobReady: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockSetJobResultKey: vi.fn(),
  mockAppendTableEvent: vi.fn(),
  mockUploadFile: vi.fn(),
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
  uploadFile: mockUploadFile,
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

describe('runTableExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTableById.mockResolvedValue(table)
    mockUpdateJobProgress.mockResolvedValue(true)
    mockMarkJobReady.mockResolvedValue(true)
    mockMarkJobFailed.mockResolvedValue(undefined)
    mockSetJobResultKey.mockResolvedValue(undefined)
    // Echo the requested key back like preserveKey-aware providers do; the runner must record
    // THIS returned key, not its own constructed one.
    mockUploadFile.mockImplementation((opts: { customKey: string }) =>
      Promise.resolve({ key: opts.customKey })
    )
    mockDeleteFile.mockResolvedValue(undefined)
    mockSelectExportRowPage.mockResolvedValue([
      { id: 'r1', data: { col_name: 'Ada' }, position: 0 },
    ])
  })

  it('pages rows, uploads the file, stamps the result key, and marks ready', async () => {
    await runTableExport(payload)

    expect(mockUploadFile).toHaveBeenCalledTimes(1)
    const upload = mockUploadFile.mock.calls[0][0]
    expect(upload.customKey).toBe('workspace/ws_1/exports/tbl_1/job_1/People.csv')
    expect(upload.preserveKey).toBe(true)
    expect(upload.contentType).toContain('text/csv')
    expect(upload.file.toString('utf8')).toBe('name\nAda\n')

    expect(mockSetJobResultKey).toHaveBeenCalledWith('tbl_1', 'job_1', upload.customKey)
    expect(mockMarkJobReady).toHaveBeenCalledWith('tbl_1', 'job_1')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'export', status: 'ready', progress: 1 })
    )
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('serializes JSON exports with display-name keys', async () => {
    await runTableExport({ ...payload, format: 'json' })
    const upload = mockUploadFile.mock.calls[0][0]
    expect(upload.customKey.endsWith('/People.json')).toBe(true)
    expect(JSON.parse(upload.file.toString('utf8'))).toEqual([{ name: 'Ada' }])
  })

  it('stops without uploading when the ownership gate is lost (cancel)', async () => {
    mockUpdateJobProgress.mockResolvedValue(false)

    await runTableExport(payload)

    expect(mockUploadFile).not.toHaveBeenCalled()
    expect(mockMarkJobReady).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('stops before the upload when ownership is lost at the finalize gate', async () => {
    mockUpdateJobProgress.mockResolvedValueOnce(true).mockResolvedValue(false)

    await runTableExport(payload)

    expect(mockSelectExportRowPage).toHaveBeenCalledTimes(1)
    expect(mockUploadFile).not.toHaveBeenCalled()
    expect(mockMarkJobReady).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('cleans up an orphaned upload when the job was canceled at the wire', async () => {
    mockMarkJobReady.mockResolvedValue(false)

    await runTableExport(payload)

    expect(mockUploadFile).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining('exports/tbl_1/job_1') })
    )
    expect(mockAppendTableEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' })
    )
  })

  it('marks the job failed and emits a failed event on error', async () => {
    mockSelectExportRowPage.mockRejectedValue(new Error('boom'))

    await runTableExport(payload)

    expect(mockMarkJobFailed).toHaveBeenCalledWith('tbl_1', 'job_1', 'boom')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'job', type: 'export', status: 'failed', error: 'boom' })
    )
  })
})
