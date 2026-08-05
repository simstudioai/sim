/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCredentialActorContext, mockGetServiceAccountToken, mockRefreshTokenIfNeeded } =
  vi.hoisted(() => ({
    mockGetCredentialActorContext: vi.fn(),
    mockGetServiceAccountToken: vi.fn(),
    mockRefreshTokenIfNeeded: vi.fn(),
  }))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mockGetCredentialActorContext,
}))
vi.mock('@/app/api/auth/oauth/utils', () => ({
  getServiceAccountToken: mockGetServiceAccountToken,
  refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
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
    vi.clearAllMocks()
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

  it('resolves a credential owned by the executing workspace', async () => {
    mockGetCredentialActorContext.mockResolvedValue(actorContext('workspace-a'))

    await expect(
      resolveVertexCredential({
        credentialId: 'cred-b',
        actingUserId: 'user-1',
        workspaceId: 'workspace-a',
      })
    ).resolves.toBe('gcp-access-token')
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
