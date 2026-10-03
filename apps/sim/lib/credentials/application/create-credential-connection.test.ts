import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  createDraft: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/credentials/application/connection-target', () => ({
  resolveCredentialConnectionTarget: hoisted.resolveTarget,
}))

vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: hoisted.createDraft,
}))

import { createCredentialConnection } from '@/lib/credentials/application/create-credential-connection'

const mocks = {
  ...hoisted,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  getBaseUrl: urlsMockFns.mockGetBaseUrl,
}

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const personalPrincipal = createPersonalApiKeyPrincipal()

describe('createCredentialConnection', () => {
  beforeEach(() => {
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveTarget.mockResolvedValue({
      provider: { serviceId: 'gmail' },
      providerId: 'google-email',
    })
    mocks.createDraft.mockResolvedValue({
      id: 'draft-1',
      expiresAt: new Date('2026-08-12T20:15:00.000Z'),
    })
    mocks.getBaseUrl.mockReturnValue('https://sim.ai')
  })

  it('creates a user-bound draft and returns its canonical connection context', async () => {
    const result = await createCredentialConnection.execute({
      principal: personalPrincipal,
      input: {
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        displayName: 'Work Gmail',
      },
    })

    expect(mocks.createDraft).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      credentialId: undefined,
      displayName: 'Work Gmail',
    })
    expect(result).toEqual({
      authorizationUrl: 'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1',
      draftId: 'draft-1',
      expiresAt: new Date('2026-08-12T20:15:00.000Z'),
      providerId: 'google-email',
      workspaceId: 'workspace-1',
    })
  })

  it("preserves an existing credential's name on reconnect", async () => {
    mocks.resolveTarget.mockResolvedValue({
      provider: { serviceId: 'gmail' },
      providerId: 'google-email',
      credentialId: 'credential-1',
      displayName: 'Existing Gmail',
    })

    await createCredentialConnection.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1', credentialId: 'credential-1' },
    })

    expect(mocks.createDraft).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      credentialId: 'credential-1',
      displayName: 'Existing Gmail',
    })
  })

  it('requires caller-managed app credentials after resolving a QuickBooks reconnect', async () => {
    mocks.resolveTarget.mockResolvedValue({
      provider: { serviceId: 'quickbooks' },
      providerId: 'quickbooks',
      credentialId: 'credential-1',
      displayName: 'Accounting',
    })

    await expect(
      createCredentialConnection.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1', credentialId: 'credential-1' },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'QuickBooks OAuth client configuration is required',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('rejects QuickBooks app credentials after resolving another provider', async () => {
    await expect(
      createCredentialConnection.execute({
        principal: personalPrincipal,
        input: {
          workspaceId: 'workspace-1',
          providerId: 'google-email',
          displayName: 'Work Gmail',
          oauthClientConfig: {
            clientId: 'client-id',
            clientSecret: 'client-secret',
            environment: 'sandbox',
            webhookVerifierToken: 'verifier-token',
          },
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'OAuth client configuration is only supported for QuickBooks',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })
})
