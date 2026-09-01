/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadFileFromStorage: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mocks.downloadFileFromStorage,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

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
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadFileFromStorage.mockResolvedValue(Buffer.from('resume'))
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.secureFetchWithPinnedIP.mockResolvedValue({ ok: true, status: 204 })
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
    expect(mocks.assertToolFileAccess).toHaveBeenCalledOnce()
    expect(mocks.downloadFileFromStorage).toHaveBeenCalledOnce()
    expect(mocks.validateUrlWithDNS).toHaveBeenCalledWith(
      'https://uploads.example.com/form',
      'uploadUrl',
      'contentFetch'
    )
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledOnce()
    const uploadOptions = mocks.secureFetchWithPinnedIP.mock.calls[0][2]
    const multipartBody = new TextDecoder().decode(uploadOptions.body as Uint8Array)
    expect(multipartBody).toContain('name="Content-Type"')
    expect(multipartBody).toContain('application/pdf')
    expect(uploadOptions.headers['Content-Length']).toBe(String(uploadOptions.body.byteLength))
    const attachBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(attachBody).toEqual({ candidateId: 'candidate-1', resumeHandle: 'handle-1' })
  })

  it('returns the storage authorization denial without downloading or uploading', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(
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
    expect(mocks.downloadFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
