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
  processFilesToUserFiles: mocks.process,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.download,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { resolveVantaUploadFile } from '@/lib/internal/vanta/file-input'
import { VANTA_MAX_TRANSFER_BYTES } from '@/lib/internal/vanta/input'

const baseInput = {
  clientId: 'client',
  clientSecret: 'secret',
  documentId: 'document-1',
}
const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }

describe('resolveVantaUploadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.process.mockReturnValue([{ ...file, type: 'text/plain' }])
    mocks.assertAccess.mockResolvedValue(null)
    mocks.download.mockResolvedValue({ buffer: Buffer.from('test'), contentType: 'text/plain' })
  })

  it('fails closed on denied stored-file access', async () => {
    mocks.assertAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    await expect(
      resolveVantaUploadFile({ ...baseInput, file }, { requestId: 'request-1', userId: 'user-1' })
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'File not found' },
    })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('passes the upload cap and cancellation to storage', async () => {
    const controller = new AbortController()
    await resolveVantaUploadFile(
      { ...baseInput, file, fileName: 'evidence.txt' },
      { requestId: 'request-1', signal: controller.signal, userId: 'user-1' }
    )

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      file.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ key: file.key }),
      'request-1',
      expect.anything(),
      { maxBytes: VANTA_MAX_TRANSFER_BYTES, signal: controller.signal }
    )
  })

  it('preserves exact size errors for declared and streamed oversized files', async () => {
    mocks.process.mockReturnValueOnce([
      { ...file, size: VANTA_MAX_TRANSFER_BYTES + 1, type: 'text/plain' },
    ])
    await expect(
      resolveVantaUploadFile({ ...baseInput, file }, { requestId: 'request-1', userId: 'user-1' })
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'File size (100.00MB) exceeds upload limit of 100MB' },
    })

    mocks.download.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'file',
        maxBytes: VANTA_MAX_TRANSFER_BYTES,
        observedBytes: VANTA_MAX_TRANSFER_BYTES + 1024 * 1024,
      })
    )
    await expect(
      resolveVantaUploadFile({ ...baseInput, file }, { requestId: 'request-1', userId: 'user-1' })
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'File size (101.00MB) exceeds upload limit of 100MB' },
    })
  })

  it('supports bounded base64 content without protected-file lookup', async () => {
    await expect(
      resolveVantaUploadFile(
        { ...baseInput, fileContent: Buffer.from('hello').toString('base64') },
        { requestId: 'request-1', userId: 'user-1' }
      )
    ).resolves.toMatchObject({
      buffer: Buffer.from('hello'),
      fileName: 'file',
      mimeType: 'application/octet-stream',
    })
    expect(mocks.assertAccess).not.toHaveBeenCalled()
  })
})
