/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  download: vi.fn(),
  process: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.process,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.download,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { resolveGoogleDriveUploadFile } from '@/lib/internal/google-drive/file-input'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }

describe('resolveGoogleDriveUploadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.process.mockReturnValue({ ...file, type: 'text/plain' })
    mocks.assertAccess.mockResolvedValue(null)
    mocks.download.mockResolvedValue({ buffer: Buffer.from('test'), contentType: 'text/plain' })
  })

  it('requires a trusted user before protected file access', async () => {
    await expect(
      resolveGoogleDriveUploadFile(file, { requestId: 'request-1' })
    ).rejects.toMatchObject({
      status: 401,
      body: { success: false, error: 'Authentication required' },
    })
    expect(mocks.assertAccess).not.toHaveBeenCalled()
  })

  it('fails closed on denied access', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    await expect(
      resolveGoogleDriveUploadFile(file, {
        requestId: 'request-1',
        userId: 'user-1',
      })
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'File not found' },
    })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('passes aggregate cap and cancellation through the servable-file resolver', async () => {
    const controller = new AbortController()
    await resolveGoogleDriveUploadFile(file, {
      requestId: 'request-1',
      signal: controller.signal,
      userId: 'user-1',
    })

    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ key: file.key }),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES, signal: controller.signal }
    )
  })

  it('preserves the clean 413 file-download envelope', async () => {
    mocks.download.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'file',
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        observedBytes: MAX_BUFFERED_TRANSFER_BYTES + 1,
      })
    )

    await expect(
      resolveGoogleDriveUploadFile(file, {
        requestId: 'request-1',
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ status: 413 })
  })
})
