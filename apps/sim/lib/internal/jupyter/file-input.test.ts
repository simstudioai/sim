/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
    fileMocks.processFilesToUserFiles.mockReturnValue([FILE])
    fileMocks.assertToolFileAccess.mockResolvedValue(null)
    fileMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
    fileMocks.docNotReadyResponse.mockReturnValue(null)
    fileMocks.isPayloadSizeLimitError.mockReturnValue(false)
  })

  it('authorizes and resolves protected Sim files under the transfer byte cap', async () => {
    const controller = new AbortController()
    const result = await resolveJupyterUploadFile(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        file: FILE,
        fileName: 'renamed.txt',
      },
      {
        userId: 'user-1',
        requestId: 'request-1',
        logger,
        signal: controller.signal,
      }
    )

    expect(result).toEqual({
      success: true,
      buffer: Buffer.from('hello'),
      fileName: 'renamed.txt',
    })
    expect(fileMocks.assertToolFileAccess).toHaveBeenCalledWith(
      FILE.key,
      'user-1',
      'request-1',
      logger
    )
    expect(fileMocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      FILE,
      'request-1',
      logger,
      {
        maxBytes: 50 * 1024 * 1024,
        signal: controller.signal,
      }
    )
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

  it('preserves the payload-too-large response for protected files', async () => {
    fileMocks.downloadServableFileFromStorage.mockRejectedValue(new Error('file too large'))
    fileMocks.isPayloadSizeLimitError.mockReturnValue(true)

    const result = await resolveJupyterUploadFile(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        file: FILE,
      },
      { userId: 'user-1', requestId: 'request-1', logger }
    )

    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected a file resolution error')
    expect(result.response.status).toBe(413)
    await expect(result.response.json()).resolves.toEqual({
      success: false,
      error: 'file too large',
    })
  })

  it('keeps legacy inline base64 support and the missing-file envelope', async () => {
    const inline = await resolveJupyterUploadFile(
      {
        serverUrl: 'http://jupyter.example.com',
        token: 'token',
        fileContent: Buffer.from('hello').toString('base64'),
      },
      { userId: 'user-1', requestId: 'request-1', logger }
    )
    expect(inline).toEqual({
      success: true,
      buffer: Buffer.from('hello'),
      fileName: 'file',
    })

    const missing = await resolveJupyterUploadFile(
      { serverUrl: 'http://jupyter.example.com', token: 'token' },
      { userId: 'user-1', requestId: 'request-1', logger }
    )
    expect(missing.success).toBe(false)
    if (missing.success) throw new Error('Expected a missing-file response')
    expect(missing.response.status).toBe(400)
    await expect(missing.response.json()).resolves.toEqual({
      success: false,
      error: 'File is required',
    })
  })
})
