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

vi.mock('@/lib/internal/dropbox/client', () => {
  class DropboxUploadError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class DropboxClient {
    constructor(token: string, signal?: AbortSignal) {
      mocks.clientConstructed(token, signal)
    }

    upload = mocks.upload
  }
  return { DropboxClient, DropboxUploadError }
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

import { executeDropboxUpload } from '@/lib/internal/dropbox/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const rawFile = { key: 'uploads/file.pdf', name: 'file.pdf', size: 4 }
const userFile = { ...rawFile, type: 'application/pdf' }

describe('executeDropboxUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processFiles.mockReturnValue([userFile])
    mocks.assertAccess.mockResolvedValue(null)
    mocks.downloadStorage.mockResolvedValue({ buffer: Buffer.from('file') })
    mocks.upload.mockResolvedValue({ id: 'dropbox-1', name: 'file.pdf' })
  })

  it('authorizes provenance, appends a folder filename, and carries cancellation', async () => {
    const controller = new AbortController()
    const input = {
      accessToken: 'token',
      path: '/Reports/',
      file: rawFile,
      fileName: 'renamed.pdf',
      mode: 'overwrite' as const,
      autorename: true,
      mute: true,
    }
    const response = await executeDropboxUpload(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })

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
    expect(mocks.upload).toHaveBeenCalledWith('/Reports/renamed.pdf', Buffer.from('file'), input)
    expect(await response.json()).toEqual({
      success: true,
      output: { file: { id: 'dropbox-1', name: 'file.pdf' } },
    })
  })

  it('does not load bytes for an unauthorized file', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeDropboxUpload(
      { accessToken: 'token', path: '/file.pdf', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mocks.downloadStorage).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('preserves legacy base64 and filename behavior for folder paths', async () => {
    await executeDropboxUpload(
      {
        accessToken: 'token',
        path: '/Legacy/',
        fileContent: Buffer.from('legacy').toString('base64'),
        fileName: 'legacy.txt',
      },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(mocks.assertAccess).not.toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledWith(
      '/Legacy/legacy.txt',
      Buffer.from('legacy'),
      expect.objectContaining({ path: '/Legacy/' })
    )
  })
})
