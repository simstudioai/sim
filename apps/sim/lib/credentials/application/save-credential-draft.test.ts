/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getActor: vi.fn(),
  createDraft: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getActor,
}))
vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: mocks.createDraft,
}))

import { saveCredentialDraft } from '@/lib/credentials/application/save-credential-draft'

const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}
const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'oauth' as const,
}

describe('saveCredentialDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getActor.mockResolvedValue({
      credential,
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })
    mocks.createDraft.mockResolvedValue({ id: 'draft-1' })
  })

  it('authorizes workspace access before resolving reconnect credential access', async () => {
    const result = await saveCredentialDraft.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        displayName: 'Work Gmail',
        credentialId: 'credential-1',
      },
    })

    expect(result).toEqual({ success: true, draftId: 'draft-1' })
    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getActor.mock.invocationCallOrder[0]
    )
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        credentialId: 'credential-1',
      })
    )
  })

  it('rejects a reconnect outside the asserted workspace', async () => {
    mocks.getActor.mockResolvedValue({
      credential: { ...credential, workspaceId: 'workspace-2' },
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    await expect(
      saveCredentialDraft.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerId: 'google-email',
          displayName: 'Work Gmail',
          credentialId: 'credential-1',
        },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('rejects managed OAuth credentials as reconnect targets', async () => {
    mocks.getActor.mockResolvedValue({
      credential: { ...credential, type: 'managed_oauth' },
      member: { role: 'admin' },
      hasWorkspaceAccess: true,
      isAdmin: true,
    })

    await expect(
      saveCredentialDraft.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerId: 'google-email',
          displayName: 'Managed Gmail',
          credentialId: 'credential-1',
        },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })
})
