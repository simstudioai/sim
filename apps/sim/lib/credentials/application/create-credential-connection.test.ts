/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  resolveTarget: vi.fn(),
  createDraft: vi.fn(),
  getBaseUrl: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/credentials/application/connection-target', () => ({
  resolveCredentialConnectionTarget: mocks.resolveTarget,
}))

vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: mocks.createDraft,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: mocks.getBaseUrl,
  SITE_URL: 'http://localhost:3000',
}))

import { createCredentialConnection } from '@/lib/credentials/application/create-credential-connection'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const personalPrincipal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}

describe('createCredentialConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('rejects workspace keys before canonical workspace loading', async () => {
    await expect(
      createCredentialConnection.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'key-1',
        },
        input: {
          workspaceId: 'workspace-1',
          providerId: 'google-email',
          displayName: 'Work Gmail',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
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
})
