/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  processSingleFileToUserFile: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
  secureFetchWithValidation: vi.fn(),
  validateMicrosoftGraphId: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation', () => ({
  validateMicrosoftGraphId: mocks.validateMicrosoftGraphId,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  secureFetchWithValidation: mocks.secureFetchWithValidation,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getExtensionFromMimeType: vi.fn(() => 'bin'),
  processSingleFileToUserFile: mocks.processSingleFileToUserFile,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { downloadOneDriveFile, uploadOneDriveFile } from '@/lib/internal/onedrive/operations'

describe('downloadOneDriveFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.validateMicrosoftGraphId.mockReturnValue({ isValid: true })
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({ id: 'file-1', name: 'report.pdf', file: { mimeType: 'application/pdf' } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
  })

  it('pins metadata and content requests and returns a bounded file envelope', async () => {
    const controller = new AbortController()
    const result = await downloadOneDriveFile(
      { accessToken: 'token', fileId: 'folder/file-1' },
      { signal: controller.signal }
    )

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
    expect(mocks.secureFetchWithPinnedIP.mock.calls[0][0]).toContain('folder%2Ffile-1')
    expect(mocks.secureFetchWithPinnedIP.mock.calls[1][2]).toEqual(
      expect.objectContaining({ signal: controller.signal })
    )
    expect(result.output.file).toEqual({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      data: 'AQID',
      size: 3,
    })
  })

  it('uploads plain content without an HTTP route hop and preserves text-file behavior', async () => {
    mocks.secureFetchWithValidation.mockResolvedValue(
      Response.json({
        id: 'file-1',
        name: 'notes.txt',
        size: 5,
        webUrl: 'https://onedrive.example/file-1',
        createdDateTime: 'created',
        lastModifiedDateTime: 'modified',
        file: { mimeType: 'text/plain' },
      })
    )
    const controller = new AbortController()
    const result = await uploadOneDriveFile(
      {
        accessToken: 'token',
        fileName: 'notes.md',
        content: 'hello',
        file: null,
        folderId: null,
        mimeType: null,
        values: null,
        conflictBehavior: null,
      },
      { requestId: 'request-1', signal: controller.signal, userId: 'user-1' }
    )

    expect(mocks.secureFetchWithValidation).toHaveBeenCalledWith(
      expect.stringContaining('/notes.txt:/content'),
      expect.objectContaining({ body: 'hello', method: 'PUT', signal: controller.signal }),
      'uploadUrl'
    )
    expect(result.output.file).toMatchObject({
      id: 'file-1',
      name: 'notes.txt',
      mimeType: 'text/plain',
    })
  })

  it('authorizes and bounds a stored file before uploading it', async () => {
    const storedFile = {
      key: 'workspace/file.bin',
      name: 'file.bin',
      size: 3,
      type: 'application/octet-stream',
    }
    mocks.processSingleFileToUserFile.mockReturnValue(storedFile)
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'application/octet-stream',
    })
    mocks.secureFetchWithValidation.mockResolvedValue(
      Response.json({
        id: 'file-1',
        name: 'file.bin',
        size: 3,
        webUrl: 'https://onedrive.example/file-1',
        createdDateTime: 'created',
        lastModifiedDateTime: 'modified',
        file: { mimeType: 'application/octet-stream' },
      })
    )
    const controller = new AbortController()
    await uploadOneDriveFile(
      {
        accessToken: 'token',
        fileName: 'file.bin',
        file: storedFile,
        content: null,
        folderId: null,
        mimeType: null,
        values: null,
        conflictBehavior: null,
      },
      { requestId: 'request-1', signal: controller.signal, userId: 'user-1' }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      storedFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      storedFile,
      'request-1',
      expect.anything(),
      expect.objectContaining({ maxBytes: 250 * 1024 * 1024, signal: controller.signal })
    )
    expect(mocks.assertToolFileAccess).toHaveBeenCalledBefore(mocks.downloadServableFileFromStorage)
  })

  it('creates a workbook and writes bounded Excel values in the same operation', async () => {
    mocks.secureFetchWithValidation
      .mockResolvedValueOnce(
        Response.json({
          id: 'file-1',
          name: 'report.xlsx',
          size: 100,
          webUrl: 'https://onedrive.example/file-1',
          createdDateTime: 'created',
          lastModifiedDateTime: 'modified',
          file: {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ id: 'session-1' }))
      .mockResolvedValueOnce(Response.json({ value: [{ name: 'Sheet1' }] }))
      .mockResolvedValueOnce(
        Response.json({
          address: 'Sheet1!A1:B2',
          values: [
            [1, 2],
            [3, 4],
          ],
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await uploadOneDriveFile(
      {
        accessToken: 'token',
        fileName: 'report.xlsx',
        file: null,
        content: null,
        folderId: null,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        values: [
          [1, 2],
          [3, 4],
        ],
        conflictBehavior: null,
      },
      { requestId: 'request-1', userId: 'user-1' }
    )

    expect(mocks.secureFetchWithValidation).toHaveBeenCalledTimes(5)
    const writeCall = mocks.secureFetchWithValidation.mock.calls[3]
    expect(writeCall[0]).toContain("range(address='A1%3AB2')")
    expect(writeCall[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          values: [
            [1, 2],
            [3, 4],
          ],
        }),
      })
    )
    expect(result.output.excelWriteResult).toEqual({
      success: true,
      updatedRange: 'Sheet1!A1:B2',
      updatedRows: 2,
      updatedColumns: 2,
      updatedCells: 4,
    })
  })
})
