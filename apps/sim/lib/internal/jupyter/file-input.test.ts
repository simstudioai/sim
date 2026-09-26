import { createLogger } from '@sim/logger'
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

const fileMocks = vi.hoisted(() => ({
  docNotReadyResponse: vi.fn(),
  isPayloadSizeLimitError: vi.fn(),
}))

vi.mock('@/lib/uploads/shared/types', () => ({
  MAX_BUFFERED_TRANSFER_BYTES: 50 * 1024 * 1024,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: fileMocks.docNotReadyResponse,
}))
vi.mock('@/lib/core/utils/stream-limits', () => ({
  isPayloadSizeLimitError: fileMocks.isPayloadSizeLimitError,
}))
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockAssertToolFileAccess } = filesAuthorizationMockFns

import { resolveJupyterUploadFile } from '@/lib/internal/jupyter/file-input'

const logger = createLogger('JupyterFileInputTest')
const FILE = {
  id: 'file-1',
  name: 'source.txt',
  url: '/api/files/serve/workspace/file-1',
  size: 5,
  type: 'text/plain',
  key: 'workspace-1/file-1',
}

describe('Jupyter upload file resolution', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([FILE])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
    fileMocks.docNotReadyResponse.mockReturnValue(null)
    fileMocks.isPayloadSizeLimitError.mockReturnValue(false)
  })

  it('returns file authorization denials without downloading bytes', async () => {
    const denied = Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    mockAssertToolFileAccess.mockResolvedValue(denied)

    const result = await resolveJupyterUploadFile(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        file: FILE,
      },
      { userId: 'user-1', requestId: 'request-1', logger }
    )

    expect(result).toEqual({ success: false, response: denied })
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })
})
