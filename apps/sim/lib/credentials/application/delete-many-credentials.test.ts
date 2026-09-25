import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/credentials/access', () => credentialsAccessMock)
vi.mock('@/lib/credentials/orchestration', () => ({
  deleteCredentialRecord: hoisted.deleteCredential,
}))
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { deleteManyCredentialsUseCase } from '@/lib/credentials/application/delete-many-credentials'

const mocks = {
  ...hoisted,
  getActor: credentialsAccessMockFns.mockGetCredentialActorContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = createDelegatedPrincipal({ audience: 'sim:credentials' })

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
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(workspace)
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
