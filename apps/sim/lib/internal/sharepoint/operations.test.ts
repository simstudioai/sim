import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientConstructed: vi.fn(),
  getMetadata: vi.fn(),
  downloadGraph: vi.fn(),
  uploadGraph: vi.fn(),
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

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

import {
  executeSharePointDownloadFile,
  executeSharePointUploadFile,
} from '@/lib/internal/sharepoint/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns

const userFile = {
  key: 'workspace/file.pdf',
  name: 'file.pdf',
  size: 4,
  type: 'application/pdf',
}

const storedFile = {
  id: 'stored-file',
  name: 'stored.bin',
  size: 5,
  type: 'application/octet-stream',
  mimeType: 'application/octet-stream',
  url: '/api/files/stored',
  key: 'execution/workspace/workflow/run/stored.bin',
  context: 'execution',
} as const

describe('SharePoint operations', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([userFile])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
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

  it('does not materialize a file when its provenance check fails', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeSharePointUploadFile(
      { accessToken: 'token', siteId: 'root', files: [userFile] },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.uploadGraph).not.toHaveBeenCalled()
  })

  it('keeps a large download in process until a stored file can be presented', async () => {
    const controller = new AbortController()
    mocks.getMetadata.mockResolvedValue({
      name: 'source.txt',
      file: { mimeType: 'text/plain' },
    })
    const buffer = Buffer.alloc(12 * 1024 * 1024, 1)
    mocks.downloadGraph.mockResolvedValue(buffer)

    const response = await executeSharePointDownloadFile(
      { accessToken: 'token', driveId: 'drive', itemId: 'item', fileName: 'renamed.txt' },
      { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.clientConstructed).toHaveBeenCalledWith('token', controller.signal)
    if (response instanceof Response) throw new Error('Expected a file output')
    expect(response.files).toHaveLength(1)
    expect(response.files[0]?.name).toBe('renamed.txt')
    expect(response.files[0]?.mimeType).toBe('text/plain')
    expect(response.files[0]?.buffer).toBe(buffer)
    expect(response.present([storedFile])).toEqual({ success: true, output: { file: storedFile } })
  })
})
