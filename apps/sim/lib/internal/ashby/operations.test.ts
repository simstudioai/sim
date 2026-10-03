import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { executeAshbyUpload } from '@/lib/internal/ashby/operations'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/resume.pdf',
  name: 'resume.pdf',
  size: 4,
  type: 'application/pdf',
  url: '/api/files/serve?key=resume.pdf',
}

describe('executeAshbyUpload', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('resume'),
      contentType: 'application/pdf',
    })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mockSecureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            success: true,
            results: {
              handle: 'handle-1',
              url: 'https://uploads.example.com/form',
              fields: { key: 'candidate/file' },
            },
          })
        )
        .mockResolvedValueOnce(
          Response.json({ success: true, results: { id: 'candidate-1', name: 'Ada' } })
        )
    )
  })

  it('authorizes storage, pins the presigned URL, uploads bytes, and attaches the handle', async () => {
    const response = await executeAshbyUpload(
      {
        apiKey: 'key',
        candidateId: 'candidate-1',
        file: FILE,
        fileName: null,
        onBehalfOfUserId: 'user-1',
      },
      'resume',
      { userId: 'sim-user', requestId: 'request-1' }
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: { id: 'candidate-1' },
    })
    expect(mockAssertToolFileAccess).toHaveBeenCalledOnce()
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledOnce()
    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://uploads.example.com/form',
      'uploadUrl',
      'contentFetch'
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledOnce()
    const uploadOptions = mockSecureFetchWithPinnedIP.mock.calls[0][2]
    const multipartBody = new TextDecoder().decode(uploadOptions.body as Uint8Array)
    expect(multipartBody).toContain('name="Content-Type"')
    expect(multipartBody).toContain('application/pdf')
    expect(uploadOptions.headers['Content-Length']).toBe(String(uploadOptions.body.byteLength))
    const attachBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(attachBody).toEqual({ candidateId: 'candidate-1', resumeHandle: 'handle-1' })
  })

  it('returns the storage authorization denial without downloading or uploading', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeAshbyUpload(
      {
        apiKey: 'key',
        candidateId: 'candidate-1',
        file: FILE,
        fileName: null,
        onBehalfOfUserId: null,
      },
      'file',
      { userId: 'sim-user', requestId: 'request-1' }
    )
    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 413 when the servable file exceeds Ashby upload limits', async () => {
    mockDownloadServableFileFromStorage.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'servable file download',
        maxBytes: 25 * 1024 * 1024,
        observedBytes: 25 * 1024 * 1024 + 1,
      })
    )
    const response = await executeAshbyUpload(
      {
        apiKey: 'key',
        candidateId: 'candidate-1',
        file: FILE,
        fileName: null,
        onBehalfOfUserId: null,
      },
      'file',
      { userId: 'sim-user', requestId: 'request-1' }
    )
    expect(response.status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
})
