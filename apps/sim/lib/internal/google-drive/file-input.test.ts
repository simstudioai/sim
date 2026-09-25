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

import { resolveGoogleDriveUploadFile } from '@/lib/internal/google-drive/file-input'

const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }

describe('resolveGoogleDriveUploadFile', () => {
  beforeEach(() => {
    mocks.process.mockReturnValue({ ...file, type: 'text/plain' })
    mocks.assertAccess.mockResolvedValue(null)
    mocks.download.mockResolvedValue({ buffer: Buffer.from('test'), contentType: 'text/plain' })
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
})
