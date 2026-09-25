import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetCredentialActorContext,
  mockGetServiceAccountToken,
  mockRefreshTokenIfNeeded,
  mockResolveExecutorCredentialToken,
} = vi.hoisted(() => ({
  mockGetCredentialActorContext: vi.fn(),
  mockGetServiceAccountToken: vi.fn(),
  mockRefreshTokenIfNeeded: vi.fn(),
  mockResolveExecutorCredentialToken: vi.fn(),
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
  canUseCredential: (access: { hasWorkspaceAccess: boolean; member: unknown; isAdmin: boolean }) =>
    access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin),
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  getServiceAccountToken: mockGetServiceAccountToken,
  refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
}))
vi.mock('@/executor/utils/credential-token', () => ({
  resolveExecutorCredentialToken: mockResolveExecutorCredentialToken,
}))

import { resolveVertexCredential } from '@/executor/utils/vertex-credential'

function actorContext(workspaceId: string) {
  return {
    credential: {
      id: 'cred-b',
      workspaceId,
      type: 'service_account',
      accountId: null,
    },
    member: { id: 'member-1' },
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    isAdmin: false,
  }
}

describe('resolveVertexCredential workspace binding', () => {
  beforeEach(() => {
    mockGetServiceAccountToken.mockResolvedValue('gcp-access-token')
  })

  it('rejects a credential owned by a different workspace than the executing workflow', async () => {
    mockGetCredentialActorContext.mockResolvedValue(actorContext('workspace-b'))

    await expect(
      resolveVertexCredential({
        credentialId: 'cred-b',
        actingUserId: 'user-1',
        workspaceId: 'workspace-a',
      })
    ).rejects.toThrow('Credential is not accessible from this workflow workspace')

    expect(mockGetServiceAccountToken).not.toHaveBeenCalled()
  })

  it('still enforces the user-to-credential check within the same workspace', async () => {
    mockGetCredentialActorContext.mockResolvedValue({
      ...actorContext('workspace-a'),
      member: null,
      isAdmin: false,
    })

    await expect(
      resolveVertexCredential({
        credentialId: 'cred-b',
        actingUserId: 'user-1',
        workspaceId: 'workspace-a',
      })
    ).rejects.toThrow('Not authorized to use this Vertex AI credential')
  })

  it('requires an authenticated acting user', async () => {
    await expect(
      resolveVertexCredential({
        credentialId: 'cred-b',
        actingUserId: undefined,
        workspaceId: 'workspace-a',
      })
    ).rejects.toThrow('requires an authenticated user')
  })
})

describe('resolveVertexCredential OAuth branch', () => {
  const oauthContext = {
    credential: { id: 'cred-o', workspaceId: 'workspace-a', type: 'oauth', accountId: 'acct-1' },
    member: { id: 'member-1' },
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    isAdmin: false,
  }

  beforeEach(() => {
    mockGetCredentialActorContext.mockResolvedValue(oauthContext)
    mockResolveExecutorCredentialToken.mockResolvedValue({ accessToken: 'oauth-access-token' })
  })

  it('authorizes before requesting a token', async () => {
    mockGetCredentialActorContext.mockResolvedValue({
      ...oauthContext,
      credential: { ...oauthContext.credential, workspaceId: 'workspace-b' },
    })

    await expect(
      resolveVertexCredential({
        credentialId: 'cred-o',
        actingUserId: 'user-1',
        workspaceId: 'workspace-a',
      })
    ).rejects.toThrow()

    expect(mockResolveExecutorCredentialToken).not.toHaveBeenCalled()
  })
})
