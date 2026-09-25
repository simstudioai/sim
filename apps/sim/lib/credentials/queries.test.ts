import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  findWorkspaceCredentialLookup,
  getCredentialById,
  getWorkspaceCredential,
  listVisibleWorkspaceCredentials,
  listWorkspacePrincipalCredentials,
  readCredentialAccountMetadata,
} from '@/lib/credentials/queries'

describe('listVisibleWorkspaceCredentials', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('always excludes managed credentials from selector-backed listings', async () => {
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    await listVisibleWorkspaceCredentials({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      workspaceAccess: { canAdmin: true },
    })

    expect(drizzleOrmMock.notInArray).toHaveBeenCalledWith(schemaMock.credential.type, [
      'managed_oauth',
      'managed_mcp',
    ])
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

  it('never selects the encrypted service-account key', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await listWorkspacePrincipalCredentials({
      workspaceId: 'workspace-1',
      types: ['oauth', 'service_account'],
      limit: 50,
    })

    expect(dbChainMockFns.select.mock.calls[0]?.[0]).not.toHaveProperty(
      'encryptedServiceAccountKey'
    )
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
  ])('excludes managed credentials from the %s path', async (_name, lookup) => {
    dbChainMockFns.limit.mockResolvedValue([])

    await lookup()

    expect(drizzleOrmMock.notInArray).toHaveBeenCalledWith(schemaMock.credential.type, [
      'managed_oauth',
      'managed_mcp',
    ])
  })
})

describe('readCredentialAccountMetadata', () => {
  beforeEach(() => resetDbChainMock())

  it('selects only non-secret metadata for the exact account/provider pair', async () => {
    const row = { externalAccountId: 'T123-U456-connection', scope: 'files:read' }
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    expect(await readCredentialAccountMetadata('account-1', 'slack')).toEqual(row)
    expect(dbChainMockFns.select).toHaveBeenCalledWith({
      externalAccountId: schemaMock.account.accountId,
      scope: schemaMock.account.scope,
    })
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.account.id, 'account-1')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.account.providerId, 'slack')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })
})
