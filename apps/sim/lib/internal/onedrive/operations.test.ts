import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import { fileUtilsServerMock } from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { assert, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  validateMicrosoftGraphId: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation', () => ({
  validateMicrosoftGraphId: mocks.validateMicrosoftGraphId,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { downloadOneDriveFile } from '@/lib/internal/onedrive/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockGetExtensionFromMimeType } = fileUtilsMockFns
const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

describe('downloadOneDriveFile', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockGetExtensionFromMimeType.mockReturnValue('bin')
    mocks.validateMicrosoftGraphId.mockReturnValue({ isValid: true })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockSecureFetchWithPinnedIP
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

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
    expect(mockSecureFetchWithPinnedIP.mock.calls[0][0]).toContain('folder%2Ffile-1')
    expect(mockSecureFetchWithPinnedIP.mock.calls[1][2]).toEqual(
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
