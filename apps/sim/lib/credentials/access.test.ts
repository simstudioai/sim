import { account, credential, credentialMember, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckWorkspaceAccess, mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
  resolveWorkspaceAccess: vi.fn(async (workspaceId: string, userId: string, provided?: any) =>
    provided && provided.workspace?.id === workspaceId
      ? provided
      : mockCheckWorkspaceAccess(workspaceId, userId)
  ),
}))

import { getCredentialActorContext, resolveCredentialTokenIdentity } from '@/lib/credentials/access'

afterAll(resetDbChainMock)

const workspaceAdminAccess = { hasAccess: true, canWrite: true, canAdmin: true }
const noWorkspaceAccess = { hasAccess: false, canWrite: false, canAdmin: false }

describe('getCredentialActorContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each(['owner', 'admin', 'shared-user'])(
    'personal token authority is exactly the immutable owner, regardless of workspace or membership admin',
    async (userId) => {
      queueTableRows(credential, [
        { id: 'token', workspaceId: 'ws', type: 'personal_token', createdBy: 'owner' },
      ])
      queueTableRows(credentialMember, [{ role: 'admin' }])
      mockCheckWorkspaceAccess.mockResolvedValue(workspaceAdminAccess)
      const result = await getCredentialActorContext('token', userId)
      expect(result.isAdmin).toBe(userId === 'owner')
      expect(Boolean(result.credential)).toBe(userId === 'owner')
      expect(result.member).toBeNull()
    }
  )

  it('treats an explicit credential admin membership as admin', async () => {
    queueTableRows(credential, [{ id: 'c1', workspaceId: 'ws', type: 'oauth' }])
    queueTableRows(credentialMember, [{ role: 'admin' }])
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true, canAdmin: false })

    const ctx = await getCredentialActorContext('c1', 'user1')

    expect(ctx.isAdmin).toBe(true)
  })

  it('derives credential admin from workspace admin for shared credentials', async () => {
    queueTableRows(credential, [{ id: 'c1', workspaceId: 'ws', type: 'oauth' }])
    mockCheckWorkspaceAccess.mockResolvedValue(workspaceAdminAccess)

    const ctx = await getCredentialActorContext('c1', 'admin-user')

    expect(ctx.isAdmin).toBe(true)
  })

  it('does not derive credential admin on personal env credentials', async () => {
    queueTableRows(credential, [{ id: 'c1', workspaceId: 'ws', type: 'env_personal' }])
    mockCheckWorkspaceAccess.mockResolvedValue(workspaceAdminAccess)

    const ctx = await getCredentialActorContext('c1', 'admin-user')

    expect(ctx.isAdmin).toBe(false)
  })

  it('is not admin for a non-admin without membership', async () => {
    queueTableRows(credential, [{ id: 'c1', workspaceId: 'ws', type: 'oauth' }])
    mockCheckWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: false,
      canAdmin: false,
    })

    const ctx = await getCredentialActorContext('c1', 'reader-user')

    expect(ctx.isAdmin).toBe(false)
  })

  it('returns empty context when the credential does not exist', async () => {
    const ctx = await getCredentialActorContext('missing', 'user1')

    expect(ctx.credential).toBeNull()
    expect(ctx.isAdmin).toBe(false)
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('exposes workspace access flags from checkWorkspaceAccess', async () => {
    queueTableRows(credential, [{ id: 'c1', workspaceId: 'ws', type: 'oauth' }])
    mockCheckWorkspaceAccess.mockResolvedValue(noWorkspaceAccess)

    const ctx = await getCredentialActorContext('c1', 'outsider')

    expect(ctx.hasWorkspaceAccess).toBe(false)
    expect(ctx.canWriteWorkspace).toBe(false)
    expect(ctx.isAdmin).toBe(false)
  })
})

describe('resolveCredentialTokenIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resolves the account owner even when it is not the caller', async () => {
    queueTableRows(credential, [{ workspaceId: 'ws', type: 'oauth', accountId: 'acct1' }])
    queueTableRows(account, [{ userId: 'authorizer' }])
    mockGetUserEntityPermissions.mockResolvedValue('write')

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toEqual({
      kind: 'oauth',
      userId: 'authorizer',
    })
  })

  it('rejects a credential belonging to another workspace', async () => {
    queueTableRows(credential, [{ workspaceId: 'other-ws', type: 'oauth', accountId: 'acct1' }])

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toBeNull()
  })

  it('reports service accounts as needing no user id', async () => {
    queueTableRows(credential, [{ workspaceId: 'ws', type: 'service_account', accountId: null }])

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toEqual({
      kind: 'service_account',
    })
  })

  it('rejects a service account from another workspace', async () => {
    queueTableRows(credential, [
      { workspaceId: 'other-ws', type: 'service_account', accountId: null },
    ])

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toBeNull()
  })

  it('rejects a credential type that is neither oauth nor a service account', async () => {
    queueTableRows(credential, [{ workspaceId: 'ws', type: 'env_personal', accountId: null }])

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toBeNull()
  })

  it('rejects when the owner no longer has workspace access', async () => {
    queueTableRows(credential, [{ workspaceId: 'ws', type: 'oauth', accountId: 'acct1' }])
    queueTableRows(account, [{ userId: 'departed' }])
    mockGetUserEntityPermissions.mockResolvedValue(null)

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toBeNull()
  })

  it('falls back to a legacy raw account id when no credential row exists', async () => {
    queueTableRows(account, [{ userId: 'legacy-owner' }])
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    await expect(resolveCredentialTokenIdentity('acct-legacy', 'ws')).resolves.toEqual({
      kind: 'oauth',
      userId: 'legacy-owner',
    })
  })

  it('returns null when the account row is missing', async () => {
    queueTableRows(credential, [{ workspaceId: 'ws', type: 'oauth', accountId: 'acct1' }])

    await expect(resolveCredentialTokenIdentity('c1', 'ws')).resolves.toBeNull()
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})

describe('organization background credential identity', () => {
  const scope = { kind: 'organization' as const, organizationId: 'org-1' }
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  it('requires current organization membership for a service-account creator', async () => {
    queueTableRows(credential, [
      { workspaceId: null, organizationId: 'org-1', createdBy: 'admin-1', type: 'service_account' },
    ])
    queueTableRows(member, [{ id: 'membership-1' }])
    await expect(resolveCredentialTokenIdentity('c1', scope)).resolves.toEqual({
      kind: 'service_account',
    })
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
  it('refuses a service account after its creator has left the organization', async () => {
    queueTableRows(credential, [
      { workspaceId: null, organizationId: 'org-1', createdBy: 'admin-1', type: 'service_account' },
    ])
    queueTableRows(member, [])
    await expect(resolveCredentialTokenIdentity('c1', scope)).resolves.toBeNull()
  })
  it('requires the OAuth account owner to be a current organization member', async () => {
    queueTableRows(credential, [
      {
        workspaceId: null,
        organizationId: 'org-1',
        createdBy: 'admin-1',
        type: 'oauth',
        accountId: 'account-1',
      },
    ])
    queueTableRows(account, [{ userId: 'admin-1' }])
    queueTableRows(member, [{ id: 'membership-1' }])
    await expect(resolveCredentialTokenIdentity('c1', scope)).resolves.toEqual({
      kind: 'oauth',
      userId: 'admin-1',
    })
  })
  it('never treats a raw account id as an organization credential', async () => {
    queueTableRows(credential, [])
    queueTableRows(account, [{ userId: 'admin-1' }])
    await expect(resolveCredentialTokenIdentity('raw-account', scope)).resolves.toBeNull()
  })
  it('denies a workspace credential when asserted as an organization source', async () => {
    queueTableRows(credential, [
      { workspaceId: 'ws-1', organizationId: null, createdBy: 'admin-1', type: 'service_account' },
    ])
    await expect(resolveCredentialTokenIdentity('c1', scope)).resolves.toBeNull()
  })
})
