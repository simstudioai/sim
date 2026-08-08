/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  authorize: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/workspace-files/application/authorization', () => ({
  authorizeWorkspaceFileAccess: mocks.authorize,
}))

import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const canonical = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

describe('loadAuthorizedWorkspaceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(canonical)
    mocks.authorize.mockResolvedValue(undefined)
  })

  it('loads canonically and authorizes the requested operation', async () => {
    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

    await expect(
      loadAuthorizedWorkspaceFile({
        principal,
        operation: fileOperations.readMetadata,
        fileId: 'file-1',
        assertedWorkspaceId: 'workspace-1',
      })
    ).resolves.toBe(canonical)

    expect(mocks.authorize).toHaveBeenCalledWith(principal, fileOperations.readMetadata, {
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      fileId: 'file-1',
    })
  })

  it('conceals missing and asserted-workspace mismatches before authorization', async () => {
    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
    mocks.loadContext.mockResolvedValueOnce(null)

    await expect(
      loadAuthorizedWorkspaceFile({
        principal,
        operation: fileOperations.readMetadata,
        fileId: 'file-1',
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      loadAuthorizedWorkspaceFile({
        principal,
        operation: fileOperations.readMetadata,
        fileId: 'file-1',
        assertedWorkspaceId: 'workspace-2',
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('propagates canonical-load infrastructure failures', async () => {
    const failure = new Error('database unavailable')
    mocks.loadContext.mockRejectedValueOnce(failure)

    await expect(
      loadAuthorizedWorkspaceFile({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        operation: fileOperations.readMetadata,
        fileId: 'file-1',
      })
    ).rejects.toBe(failure)
  })
})
