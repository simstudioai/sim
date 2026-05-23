/**
 * @vitest-environment node
 */
import {
  inputValidationMock,
  inputValidationMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadWorkspaceFile } = vi.hoisted(() => ({
  mockUploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

import {
  ExternalUrlValidationError,
  fetchExternalUrlToWorkspace,
} from '@/lib/uploads/contexts/workspace/fetch-external-url'

function makeResponse(body: string, contentType = 'application/octet-stream'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

describe('fetchExternalUrlToWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockUploadWorkspaceFile.mockImplementation(
      async (workspaceId: string, _userId: string, _buffer: Buffer, fileName: string) => ({
        id: `wf_${fileName}`,
        name: fileName,
        size: 0,
        type: 'application/octet-stream',
        url: `/api/files/serve/${workspaceId}/${fileName}`,
        key: `${workspaceId}/${fileName}`,
        context: 'workspace',
      })
    )
  })

  it('downloads each URL independently — never dedups by path filename', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(makeResponse('first bytes', 'image/png'))
      .mockResolvedValueOnce(makeResponse('different second bytes', 'image/png'))

    const first = await fetchExternalUrlToWorkspace({
      url: 'https://files.slack.com/files-pri/T07-FAAA/download/image.png',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const second = await fetchExternalUrlToWorkspace({
      url: 'https://files.slack.com/files-pri/T07-FBBB/download/image.png',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(first.filename).toBe('image.png')
    expect(second.filename).toBe('image.png')
    expect(first.buffer.toString()).toBe('first bytes')
    expect(second.buffer.toString()).toBe('different second bytes')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledTimes(2)
  })

  it('throws ExternalUrlValidationError when SSRF validation fails', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'Blocked private IP',
    })

    await expect(
      fetchExternalUrlToWorkspace({
        url: 'http://169.254.169.254/secret',
        userId: 'user-1',
      })
    ).rejects.toBeInstanceOf(ExternalUrlValidationError)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('throws on non-2xx fetch responses', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' })
    )

    await expect(
      fetchExternalUrlToWorkspace({
        url: 'https://example.com/missing.txt',
        userId: 'user-1',
      })
    ).rejects.toThrow(/404/)
  })

  it('skips workspace save when saveToWorkspace is false', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      saveToWorkspace: false,
    })

    expect(result.savedWorkspaceFile).toBeUndefined()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('skips workspace save when no workspaceId is provided', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
    })

    expect(result.savedWorkspaceFile).toBeUndefined()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('skips workspace save when user lacks write permission', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.savedWorkspaceFile).toBeUndefined()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns parsed bytes but skips save when user is not a workspace member', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(null)

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.buffer.toString()).toBe('bytes')
    expect(result.savedWorkspaceFile).toBeUndefined()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns the saved workspace file when permission allows save', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/notes.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      expect.any(Buffer),
      'notes.txt',
      'text/plain'
    )
    expect(result.savedWorkspaceFile?.key).toBe('workspace-1/notes.txt')
  })

  it('swallows workspace save errors so parsing can still proceed', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )
    mockUploadWorkspaceFile.mockRejectedValueOnce(new Error('disk full'))

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.buffer.toString()).toBe('bytes')
    expect(result.savedWorkspaceFile).toBeUndefined()
  })

  it('forwards custom headers to the fetch', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('bytes', 'text/plain')
    )

    await fetchExternalUrlToWorkspace({
      url: 'https://files.slack.com/files-pri/T07/download/report.txt',
      userId: 'user-1',
      headers: { Authorization: 'Bearer xoxb-test-token' },
    })

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://files.slack.com/files-pri/T07/download/report.txt',
      '203.0.113.10',
      expect.objectContaining({
        headers: { Authorization: 'Bearer xoxb-test-token' },
      })
    )
  })

  it('uses content-type from response headers', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      makeResponse('pdf bytes', 'application/pdf')
    )

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/report.pdf',
      userId: 'user-1',
    })

    expect(result.mimeType).toBe('application/pdf')
  })
})
