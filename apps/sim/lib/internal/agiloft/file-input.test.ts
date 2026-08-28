/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  docNotReadyResponse: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  isPayloadSizeLimitError: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))
vi.mock('@/lib/core/utils/stream-limits', () => ({
  isPayloadSizeLimitError: fileMocks.isPayloadSizeLimitError,
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

import { AgiloftOperationError } from '@/lib/internal/agiloft/errors'
import { resolveAgiloftAttachmentFile } from '@/lib/internal/agiloft/file-input'

const RAW_FILE = {
  id: 'file-1',
  name: 'evidence.txt',
  url: '/api/files/serve/file-1',
  size: 5,
  type: 'text/plain',
  key: 'workspace-1/file-1',
}

const USER_FILE = {
  ...RAW_FILE,
  context: 'workspace',
}

async function expectOperationError(
  promise: Promise<unknown>,
  expected: { status: number; body: unknown }
) {
  try {
    await promise
    throw new Error('Expected AgiloftOperationError')
  } catch (error) {
    expect(error).toBeInstanceOf(AgiloftOperationError)
    expect(error).toMatchObject(expected)
  }
}

describe('Agiloft attachment file resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileMocks.processFilesToUserFiles.mockReturnValue([USER_FILE])
    fileMocks.assertToolFileAccess.mockResolvedValue(null)
    fileMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
    fileMocks.docNotReadyResponse.mockReturnValue(null)
    fileMocks.isPayloadSizeLimitError.mockReturnValue(false)
  })

  it.each(['workspace', 'mothership', 'execution', 'copilot', 'knowledge-base', 'chat', 'general'])(
    'preserves fail-closed authorization for %s file inputs',
    async (context) => {
      const file = { ...RAW_FILE, context, key: `${context}/file-1` }
      const userFile = { ...USER_FILE, ...file }
      fileMocks.processFilesToUserFiles.mockReturnValueOnce([userFile])

      const result = await resolveAgiloftAttachmentFile(file, {
        userId: 'user-1',
        requestId: 'request-1',
      })

      expect(result).toEqual({ userFile, buffer: Buffer.from('hello') })
      expect(fileMocks.assertToolFileAccess).toHaveBeenCalledWith(
        userFile.key,
        'user-1',
        'request-1',
        expect.anything()
      )
    }
  )

  it('forwards cancellation and the bounded-transfer limit to storage', async () => {
    const controller = new AbortController()

    await resolveAgiloftAttachmentFile(RAW_FILE, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })

    expect(fileMocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      USER_FILE,
      'request-1',
      expect.anything(),
      { maxBytes: 50 * 1024 * 1024, signal: controller.signal }
    )
  })

  it('propagates cancellation before and after file authorization', async () => {
    const before = new AbortController()
    before.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      resolveAgiloftAttachmentFile(RAW_FILE, {
        userId: 'user-1',
        requestId: 'request-1',
        signal: before.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fileMocks.assertToolFileAccess).not.toHaveBeenCalled()

    const after = new AbortController()
    fileMocks.assertToolFileAccess.mockImplementationOnce(async () => {
      after.abort(new DOMException('cancelled', 'AbortError'))
      return null
    })
    await expect(
      resolveAgiloftAttachmentFile(RAW_FILE, {
        userId: 'user-1',
        requestId: 'request-1',
        signal: after.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fileMocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('accepts the serialized file shape produced by advanced-mode inputs', async () => {
    const result = await resolveAgiloftAttachmentFile(JSON.stringify(RAW_FILE), {
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({ userFile: USER_FILE, buffer: Buffer.from('hello') })
    expect(fileMocks.processFilesToUserFiles).toHaveBeenCalledWith(
      [RAW_FILE],
      'request-1',
      expect.anything()
    )
  })

  it('preserves authorization denials and rejects missing or invalid files', async () => {
    fileMocks.assertToolFileAccess.mockResolvedValueOnce(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    await expectOperationError(
      resolveAgiloftAttachmentFile(RAW_FILE, {
        userId: 'user-1',
        requestId: 'request-1',
      }),
      { status: 404, body: { success: false, error: 'File not found' } }
    )
    expect(fileMocks.downloadServableFileFromStorage).not.toHaveBeenCalled()

    await expectOperationError(
      resolveAgiloftAttachmentFile(undefined, {
        userId: 'user-1',
        requestId: 'request-1',
      }),
      { status: 400, body: { success: false, error: 'File is required' } }
    )
    await expectOperationError(
      resolveAgiloftAttachmentFile('/api/files/serve/file-1', {
        userId: 'user-1',
        requestId: 'request-1',
      }),
      { status: 400, body: { success: false, error: 'Invalid file input' } }
    )
  })

  it('preserves payload-too-large responses', async () => {
    fileMocks.downloadServableFileFromStorage.mockRejectedValueOnce(new Error('file too large'))
    fileMocks.isPayloadSizeLimitError.mockReturnValueOnce(true)

    await expectOperationError(
      resolveAgiloftAttachmentFile(RAW_FILE, {
        userId: 'user-1',
        requestId: 'request-1',
      }),
      { status: 413, body: { success: false, error: 'file too large' } }
    )
  })
})
