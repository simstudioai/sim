/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getActor: vi.fn(),
  deleteCredential: vi.fn(),
  capture: vi.fn(),
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
vi.mock('@/lib/credentials/orchestration', () => ({
  deleteCredentialRecord: mocks.deleteCredential,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { deleteManyCredentialsUseCase } from '@/lib/credentials/application/delete-many-credentials'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:credentials',
  issuedAt: new Date('2026-08-14T12:00:00.000Z'),
  expiresAt: new Date('2030-08-14T12:05:00.000Z'),
}

function oauthCredential(id: string, workspaceId = 'workspace-1') {
  return {
    id,
    workspaceId,
    type: 'oauth' as const,
    displayName: `OAuth ${id}`,
    description: null,
    providerId: 'google-email',
    accountId: `account-${id}`,
    envKey: null,
    envOwnerUserId: null,
    encryptedServiceAccountKey: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-08-14T12:00:00.000Z'),
    updatedAt: new Date('2026-08-14T12:00:00.000Z'),
  }
}

describe('deleteManyCredentialsUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.deleteCredential.mockResolvedValue(true)
  })

  it('deletes only OAuth credentials administered in the delegated workspace', async () => {
    const allowed = oauthCredential('credential-1')
    mocks.getActor
      .mockResolvedValueOnce({
        credential: allowed,
        member: { role: 'admin' },
        hasWorkspaceAccess: true,
        isAdmin: true,
      })
      .mockResolvedValueOnce({
        credential: oauthCredential('credential-2', 'workspace-2'),
        member: { role: 'admin' },
        hasWorkspaceAccess: true,
        isAdmin: true,
      })

    const result = await deleteManyCredentialsUseCase.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        credentialIds: ['credential-1', 'credential-2'],
      },
    })

    expect(result).toEqual({
      deleted: ['credential-1'],
      failed: ['credential-2'],
      deletedCredentials: [allowed],
    })
    expect(mocks.deleteCredential).toHaveBeenCalledOnce()
    expect(mocks.deleteCredential).toHaveBeenCalledWith({
      credential: allowed,
      reason: 'copilot_delete',
    })
  })

  it('rejects duplicate IDs before loading any credential', async () => {
    await expect(
      deleteManyCredentialsUseCase.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          credentialIds: ['credential-1', 'credential-1'],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.getActor).not.toHaveBeenCalled()
    expect(mocks.deleteCredential).not.toHaveBeenCalled()
  })
})
