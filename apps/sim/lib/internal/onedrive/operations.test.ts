import { assert, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'

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

import { downloadOneDriveFile } from '@/lib/internal/onedrive/operations'

describe('downloadOneDriveFile', () => {
  beforeEach(() => {
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
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      {
        name: 'report.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from([1, 2, 3]),
      },
    ])
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'report.pdf',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: 3,
      context: 'execution',
    }
    expect(result.present([storedFile])).toEqual({ success: true, output: { file: storedFile } })
  })
})
