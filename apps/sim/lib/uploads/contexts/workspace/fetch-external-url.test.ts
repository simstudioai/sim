/**
 * Uses vi.spyOn against the shared module instances instead of vi.mock: under
 * `isolate: false` the module under test may already be cached from another
 * test file, bound to whatever dependency instances were live at that time.
 * Spying on the instance this file resolves patches the exact namespace the
 * cached module reads at call time, so the tests behave identically whether
 * the module graph is fresh or reused.
 */
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import * as inputValidation from '@/lib/core/security/input-validation.server'
import {
  ExternalUrlValidationError,
  fetchExternalUrlToWorkspace,
} from '@/lib/uploads/contexts/workspace/fetch-external-url'
import * as workspaceFileManager from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import * as workspacePermissions from '@/lib/workspaces/permissions/utils'

let validateUrlWithDNSSpy: MockInstance<typeof inputValidation.validateUrlWithDNS>
let secureFetchWithPinnedIPSpy: MockInstance<typeof inputValidation.secureFetchWithPinnedIP>
let getUserEntityPermissionsSpy: MockInstance<typeof workspacePermissions.getUserEntityPermissions>
let uploadWorkspaceFileSpy: MockInstance<typeof workspaceFileManager.uploadWorkspaceFile>
beforeEach(() => {
  validateUrlWithDNSSpy = vi.spyOn(inputValidation, 'validateUrlWithDNS')
  secureFetchWithPinnedIPSpy = vi.spyOn(inputValidation, 'secureFetchWithPinnedIP')
  getUserEntityPermissionsSpy = vi.spyOn(workspacePermissions, 'getUserEntityPermissions')
  uploadWorkspaceFileSpy = vi.spyOn(workspaceFileManager, 'uploadWorkspaceFile')
})

function makeResponse(body: string, contentType = 'application/octet-stream'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

const warnMock = getMockLogger('FetchExternalUrl').warn

describe('fetchExternalUrlToWorkspace', () => {
  beforeEach(() => {
    validateUrlWithDNSSpy.mockReset()
    secureFetchWithPinnedIPSpy.mockReset()
    getUserEntityPermissionsSpy.mockReset()
    uploadWorkspaceFileSpy.mockReset()

    validateUrlWithDNSSpy.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    getUserEntityPermissionsSpy.mockResolvedValue('write')
    uploadWorkspaceFileSpy.mockImplementation(
      async (workspaceId: string, _userId: string, _buffer: Buffer, fileName: string) =>
        ({
          id: `wf_${fileName}`,
          name: fileName,
          size: 0,
          type: 'application/octet-stream',
          url: `/api/files/serve/${workspaceId}/${fileName}`,
          key: `${workspaceId}/${fileName}`,
          context: 'workspace',
        }) as unknown as Awaited<ReturnType<typeof workspaceFileManager.uploadWorkspaceFile>>
    )
  })

  afterAll(() => {
    validateUrlWithDNSSpy.mockRestore()
    secureFetchWithPinnedIPSpy.mockRestore()
    getUserEntityPermissionsSpy.mockRestore()
    uploadWorkspaceFileSpy.mockRestore()
  })

  it('downloads each URL independently — never dedups by path filename', async () => {
    secureFetchWithPinnedIPSpy
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
    expect(secureFetchWithPinnedIPSpy).toHaveBeenCalledTimes(2)
    expect(uploadWorkspaceFileSpy).toHaveBeenCalledTimes(2)
  })

  it('throws ExternalUrlValidationError when SSRF validation fails', async () => {
    validateUrlWithDNSSpy.mockResolvedValue({
      isValid: false,
      error: 'Blocked private IP',
    })

    await expect(
      fetchExternalUrlToWorkspace({
        url: 'http://169.254.169.254/secret',
        userId: 'user-1',
      })
    ).rejects.toBeInstanceOf(ExternalUrlValidationError)
    expect(secureFetchWithPinnedIPSpy).not.toHaveBeenCalled()
  })

  it('skips workspace save when user lacks write permission', async () => {
    secureFetchWithPinnedIPSpy.mockResolvedValue(makeResponse('bytes', 'text/plain'))
    getUserEntityPermissionsSpy.mockResolvedValue('read')

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.savedWorkspaceFile).toBeUndefined()
    expect(uploadWorkspaceFileSpy).not.toHaveBeenCalled()
  })

  it('returns parsed bytes but skips save when user is not a workspace member', async () => {
    secureFetchWithPinnedIPSpy.mockResolvedValue(makeResponse('bytes', 'text/plain'))
    getUserEntityPermissionsSpy.mockResolvedValue(null)

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.buffer.toString()).toBe('bytes')
    expect(result.savedWorkspaceFile).toBeUndefined()
    expect(uploadWorkspaceFileSpy).not.toHaveBeenCalled()
  })

  it('swallows workspace save errors so parsing can still proceed', async () => {
    secureFetchWithPinnedIPSpy.mockResolvedValue(makeResponse('bytes', 'text/plain'))
    uploadWorkspaceFileSpy.mockRejectedValueOnce(new Error('disk full'))

    const result = await fetchExternalUrlToWorkspace({
      url: 'https://example.com/file.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(result.buffer.toString()).toBe('bytes')
    expect(result.savedWorkspaceFile).toBeUndefined()
  })
})
