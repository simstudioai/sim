/**
 * @vitest-environment node
 */
import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  findWorkspaceCredentialLookup,
  getCredentialById,
  getWorkspaceCredential,
  listVisibleWorkspaceCredentials,
  listWorkspacePrincipalCredentials,
} from '@/lib/credentials/queries'

describe('listVisibleWorkspaceCredentials', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('always excludes managed OAuth credentials from selector-backed listings', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    await listVisibleWorkspaceCredentials({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      workspaceAccess: { canAdmin: true },
    })

    expect(drizzleOrmMock.ne).toHaveBeenCalledWith(schemaMock.credential.type, 'managed_oauth')
  })

  it('does not expose Credential Group configuration on a custom Slack bot', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'service_account',
        displayName: 'Support bot',
        description: null,
        providerId: 'slack-custom-bot',
        accountId: null,
        envKey: null,
        envOwnerUserId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        encryptedServiceAccountKey: 'encrypted',
        memberRole: null,
      },
    ])

    const { data } = await listVisibleWorkspaceCredentials({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      workspaceAccess: { canAdmin: true },
    })
    const [result] = data

    expect(result).not.toHaveProperty('managedOAuthConfigurationStatus')
    expect(result).not.toHaveProperty('authorizationAppId')
    expect(result).not.toHaveProperty('managedOauthScopeVersion')
  })
})

describe('listWorkspacePrincipalCredentials', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('selects and returns only connection metadata', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'service_account',
        displayName: 'Zoom account',
        description: null,
        providerId: 'zoom-service-account',
        accountId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        hasServiceAccountKey: true,
      },
    ])

    const result = await listWorkspacePrincipalCredentials({
      workspaceId: 'workspace-1',
      types: ['oauth', 'service_account'],
      limit: 50,
    })

    expect(result.nextCursorKeys).toBeNull()
    expect(result.data).toEqual([
      {
        id: 'credential-1',
        workspaceId: 'workspace-1',
        type: 'service_account',
        displayName: 'Zoom account',
        description: null,
        providerId: 'zoom-service-account',
        accountId: null,
        envKey: null,
        envOwnerUserId: null,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        hasServiceAccountKey: true,
        role: 'member',
      },
    ])
    expect(dbChainMockFns.select.mock.calls[0]?.[0]).not.toHaveProperty(
      'encryptedServiceAccountKey'
    )
  })

  it('fails fast on an empty connection-type policy', async () => {
    await expect(
      listWorkspacePrincipalCredentials({ workspaceId: 'workspace-1', types: [], limit: 50 })
    ).rejects.toThrow('Workspace credential types cannot be empty')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    const failure = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(failure)

    await expect(
      listWorkspacePrincipalCredentials({
        workspaceId: 'workspace-1',
        types: ['oauth', 'service_account'],
        limit: 50,
      })
    ).rejects.toBe(failure)
  })
})

describe('ordinary credential lookups', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([
    [
      'workspace credential',
      () => getWorkspaceCredential({ workspaceId: 'workspace-1', credentialId: 'credential-1' }),
    ],
    ['credential by id', () => getCredentialById('credential-1')],
    [
      'legacy id/account lookup',
      () =>
        findWorkspaceCredentialLookup({
          workspaceId: 'workspace-1',
          credentialId: 'credential-1',
        }),
    ],
  ])('excludes managed OAuth from the %s path', async (_name, lookup) => {
    dbChainMockFns.limit.mockResolvedValue([])

    await lookup()

    expect(drizzleOrmMock.ne).toHaveBeenCalledWith(schemaMock.credential.type, 'managed_oauth')
  })
})
