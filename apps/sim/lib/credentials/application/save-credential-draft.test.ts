import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  createDraft: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/credentials/access', () => credentialsAccessMock)
vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: hoisted.createDraft,
}))

import { saveCredentialDraft } from '@/lib/credentials/application/save-credential-draft'

const mocks = {
  ...hoisted,
  getActor: credentialsAccessMockFns.mockGetCredentialActorContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
}

const principal = createSessionPrincipal()
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
