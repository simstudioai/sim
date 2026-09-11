/**
 * @vitest-environment node
 */
import { assert, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadPipedriveFile: vi.fn(),
  listPipedriveFiles: vi.fn(),
}))

vi.mock('@/lib/internal/pipedrive/client', () => mocks)

import { executePipedriveGetFiles } from '@/lib/internal/pipedrive/operations'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

describe('executePipedriveGetFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listPipedriveFiles.mockResolvedValue({
      files: [{ id: 1, name: 'report.pdf', url: 'https://files.example/report.pdf' }],
      hasMore: true,
      nextStart: 1,
    })
  })

  it('keeps large downloads out of JSON while preserving file-list pagination', async () => {
    const buffer = Buffer.alloc(11 * 1024 * 1024, 1)
    mocks.downloadPipedriveFile.mockResolvedValue({ buffer, contentType: 'application/pdf' })
    const controller = new AbortController()
    const input = { accessToken: 'token', downloadFiles: true }
    const result = await executePipedriveGetFiles(input, {
      requestId: 'request-1',
      signal: controller.signal,
    })

    assert(isInternalToolFileResult(result))
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.buffer).toBe(buffer)
    expect(result.files[0]?.name).toBe('report.pdf')
    expect(result.files[0]?.mimeType).toBe('application/pdf')
    expect(mocks.downloadPipedriveFile).toHaveBeenCalledWith(
      'https://files.example/report.pdf',
      input,
      MAX_BUFFERED_TRANSFER_BYTES,
      controller.signal
    )
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'report.pdf',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: buffer.length,
      context: 'execution',
    }
    expect(result.present([storedFile])).toEqual({
      success: true,
      output: {
        files: [{ id: 1, name: 'report.pdf', url: 'https://files.example/report.pdf' }],
        downloadedFiles: [storedFile],
        total_items: 1,
        has_more: true,
        next_start: 1,
        success: true,
      },
    })
  })

  it('returns metadata without file persistence when downloads are disabled', async () => {
    const result = await executePipedriveGetFiles(
      { accessToken: 'token', downloadFiles: false },
      { requestId: 'request-1' }
    )

    expect(isInternalToolFileResult(result)).toBe(false)
    expect(result).toMatchObject({ success: true, output: { has_more: true, next_start: 1 } })
    expect(mocks.downloadPipedriveFile).not.toHaveBeenCalled()
  })
})
