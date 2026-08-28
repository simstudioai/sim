/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientConstructed: vi.fn(),
  getMetadata: vi.fn(),
  downloadGraph: vi.fn(),
  uploadGraph: vi.fn(),
  processFiles: vi.fn(),
  downloadStorage: vi.fn(),
  assertAccess: vi.fn(),
}))

vi.mock('@/lib/internal/sharepoint/client', () => {
  class SharePointGraphError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class SharePointClient {
    static errorMessage(result: { data?: { error?: { message?: string } } }, fallback: string) {
      return result.data?.error?.message || fallback
    }

    constructor(accessToken: string, signal?: AbortSignal) {
      mocks.clientConstructed(accessToken, signal)
    }

    getMetadata = mocks.getMetadata
    download = mocks.downloadGraph
    upload = mocks.uploadGraph
  }
  return { SharePointClient, SharePointGraphError }
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

import {
  executeSharePointDownloadFile,
  executeSharePointUploadFile,
  MAX_SHAREPOINT_UPLOAD_BYTES,
} from '@/lib/internal/sharepoint/operations'

const userFile = {
  key: 'workspace/file.pdf',
  name: 'file.pdf',
  size: 4,
  type: 'application/pdf',
}

describe('SharePoint operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processFiles.mockReturnValue([userFile])
    mocks.assertAccess.mockResolvedValue(null)
    mocks.downloadStorage.mockResolvedValue({
      buffer: Buffer.from('file'),
      contentType: 'application/pdf',
    })
    mocks.uploadGraph.mockResolvedValue({
      ok: true,
      status: 201,
      data: {
        id: 'item-1',
        name: 'file.pdf',
        webUrl: 'https://example.com/file.pdf',
        size: 4,
      },
    })
  })

  it('authorizes input provenance and carries cancellation through storage and Graph upload', async () => {
    const controller = new AbortController()
    const response = await executeSharePointUploadFile(
      {
        accessToken: 'token',
        siteId: 'root',
        driveId: 'drive/id',
        folderPath: '/Shared Documents/Reports/',
        fileName: null,
        files: [userFile],
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
      maxBytes: MAX_SHAREPOINT_UPLOAD_BYTES,
      signal: controller.signal,
    })
    expect(mocks.clientConstructed).toHaveBeenCalledWith('token', controller.signal)
    expect(mocks.uploadGraph).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/drives/drive%2Fid/root:/Shared%20Documents/Reports/file.pdf:/content',
      Buffer.from('file'),
      'application/pdf'
    )
    expect(await response.json()).toEqual({
      success: true,
      output: {
        uploadedFiles: [
          {
            id: 'item-1',
            name: 'file.pdf',
            webUrl: 'https://example.com/file.pdf',
            size: 4,
          },
        ],
        fileCount: 1,
        skippedFiles: [],
        skippedCount: 0,
        errors: [],
      },
    })
  })

  it('does not materialize a file when its provenance check fails', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeSharePointUploadFile(
      { accessToken: 'token', siteId: 'root', files: [userFile] },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mocks.downloadStorage).not.toHaveBeenCalled()
    expect(mocks.uploadGraph).not.toHaveBeenCalled()
  })

  it('preserves the inline download output contract and cancellation signal', async () => {
    const controller = new AbortController()
    mocks.getMetadata.mockResolvedValue({
      name: 'source.txt',
      file: { mimeType: 'text/plain' },
    })
    mocks.downloadGraph.mockResolvedValue(Buffer.from('hello'))

    const response = await executeSharePointDownloadFile(
      { accessToken: 'token', driveId: 'drive', itemId: 'item', fileName: 'renamed.txt' },
      { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.clientConstructed).toHaveBeenCalledWith('token', controller.signal)
    expect(await response.json()).toEqual({
      success: true,
      output: {
        file: {
          name: 'renamed.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hello').toString('base64'),
          size: 5,
        },
      },
    })
  })
})
