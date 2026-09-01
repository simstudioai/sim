/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientConstructed: vi.fn(),
  upload: vi.fn(),
  processFiles: vi.fn(),
  downloadStorage: vi.fn(),
  assertAccess: vi.fn(),
}))

vi.mock('@/lib/internal/box/client', () => {
  class BoxUploadError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class BoxClient {
    constructor(token: string, signal?: AbortSignal) {
      mocks.clientConstructed(token, signal)
    }

    upload = mocks.upload
  }
  return { BoxClient, BoxUploadError }
})

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadStorage,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertAccess,
}))

import { executeBoxUploadFile } from '@/lib/internal/box/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const rawFile = { key: 'uploads/file.pdf', name: 'file.pdf', size: 4 }
const userFile = { ...rawFile, type: 'application/pdf' }

describe('executeBoxUploadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processFiles.mockReturnValue([userFile])
    mocks.assertAccess.mockResolvedValue(null)
    mocks.downloadStorage.mockResolvedValue({ buffer: Buffer.from('file') })
    mocks.upload.mockResolvedValue({ id: 'box-1', name: 'override.pdf', size: 4 })
  })

  it('authorizes provenance and propagates cancellation through storage and Box', async () => {
    const controller = new AbortController()
    const response = await executeBoxUploadFile(
      {
        accessToken: 'token',
        parentFolderId: '0',
        file: rawFile,
        fileName: 'override.pdf',
      },
      { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      userFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadStorage).toHaveBeenCalledWith(userFile, 'request-1', expect.anything(), {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      signal: controller.signal,
    })
    expect(mocks.clientConstructed).toHaveBeenCalledWith('token', controller.signal)
    expect(mocks.upload).toHaveBeenCalledWith('0', 'override.pdf', Buffer.from('file'))
    expect(await response.json()).toEqual({
      success: true,
      output: { id: 'box-1', name: 'override.pdf', size: 4 },
    })
  })

  it('never materializes an unauthorized file', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeBoxUploadFile(
      { accessToken: 'token', parentFolderId: '0', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mocks.downloadStorage).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('preserves legacy base64 uploads without invoking file authorization', async () => {
    await executeBoxUploadFile(
      {
        accessToken: 'token',
        parentFolderId: 'folder-1',
        fileContent: Buffer.from('legacy').toString('base64'),
        fileName: 'legacy.txt',
      },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(mocks.assertAccess).not.toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledWith('folder-1', 'legacy.txt', Buffer.from('legacy'))
  })
})
