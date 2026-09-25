import { createLogger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  processFilesToUserFiles: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  assertToolFileAccess: vi.fn(),
  docNotReadyResponse: vi.fn(),
  isPayloadSizeLimitError: vi.fn(),
}))

vi.mock('@/lib/uploads/shared/types', () => ({
  MAX_BUFFERED_TRANSFER_BYTES: 50 * 1024 * 1024,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: fileMocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: fileMocks.downloadServableFileFromStorage,
}))
vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: fileMocks.docNotReadyResponse,
}))
vi.mock('@/lib/core/utils/stream-limits', () => ({
  isPayloadSizeLimitError: fileMocks.isPayloadSizeLimitError,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))

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
    fileMocks.processFilesToUserFiles.mockReturnValue([FILE])
    fileMocks.assertToolFileAccess.mockResolvedValue(null)
    fileMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
    fileMocks.docNotReadyResponse.mockReturnValue(null)
    fileMocks.isPayloadSizeLimitError.mockReturnValue(false)
  })

  it('returns file authorization denials without downloading bytes', async () => {
    const denied = Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    fileMocks.assertToolFileAccess.mockResolvedValue(denied)

    const result = await resolveJupyterUploadFile(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        file: FILE,
      },
      { userId: 'user-1', requestId: 'request-1', logger }
    )

    expect(result).toEqual({ success: false, response: denied })
    expect(fileMocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
  })
})
