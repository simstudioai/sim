/** @vitest-environment node */
import { account, credential } from '@sim/db/schema'
import { auditMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  catalog: vi.fn(),
  requireOAuth: vi.fn(),
  requireService: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  draft: vi.fn(),
  getDraft: vi.fn(),
  getCredential: vi.fn(),
  resolveToken: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
  requireOrganizationMembership: vi.fn(),
}))
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.catalog,
  requireAvailableOAuthCredentialProvider: mocks.requireOAuth,
  requireAvailableServiceAccountCredentialProvider: mocks.requireService,
}))
vi.mock('@/lib/credentials/application/credential-crud', () => ({
  throwCredentialMutationFailure: (result: { error?: string }) => {
    throw new Error(result.error)
  },
}))
vi.mock('@/lib/credentials/orchestration/credential-create', () => ({
  createCredentialRecord: mocks.create,
}))
vi.mock('@/lib/credentials/orchestration', () => ({ updateCredentialRecord: mocks.update }))
vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: mocks.draft,
  getActiveConnectDraft: mocks.getDraft,
}))
vi.mock('@/lib/credentials/organization', () => ({
  getOrganizationCredential: mocks.getCredential,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialTokenBundle: mocks.resolveToken,
}))
vi.mock('@/lib/oauth/utils', () => ({
  getServiceConfigByProviderId: () => ({ serviceAccountProviderId: 'google-service-account' }),
}))

import {
  createOrganizationCredential,
  launchOrganizationCredentialConnection,
  listOrganizationCredentials,
  organizationCredentialOperations,
  resolveOrganizationCredentialTokenBundle,
  saveOrganizationCredentialDraft,
  updateOrganizationCredential,
} from '@/lib/credentials/application/organization-credentials'

const principal = { kind: 'session' as const, userId: 'admin-1', sessionId: 'session-1' }
const row = {
  id: 'credential-1',
  organizationId: 'org-1',
  workspaceId: null,
  type: 'service_account',
  providerId: 'google-service-account',
  displayName: 'Drive service account',
  createdBy: 'admin-1',
}

describe('organization connection application boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.authorize.mockResolvedValue({ organizationId: 'org-1', userId: 'admin-1', role: 'admin' })
    mocks.catalog.mockResolvedValue([])
    mocks.create.mockResolvedValue({ success: true, created: true, credential: row })
    mocks.getCredential.mockResolvedValue(row)
    mocks.draft.mockResolvedValue({ id: 'draft-1' })
    mocks.resolveToken.mockResolvedValue({ accessToken: 'token' })
    mocks.update.mockResolvedValue({ success: true, updatedFields: ['description'] })
  })

  it('lists each linked OAuth account’s granted scopes without combining provider grants', async () => {
    mocks.catalog.mockResolvedValue([
      {
        type: 'oauth',
        available: true,
        authorizationOptions: [{ providerId: 'google-drive' }],
      },
    ])
    queueTableRows(credential, [
      {
        ...row,
        id: 'credential-full',
        accountId: 'account-full',
        type: 'oauth',
        providerId: 'google-drive',
        accountScope: ' drive.readonly\t drive.metadata.readonly,openid ',
      },
      {
        ...row,
        id: 'credential-limited',
        accountId: 'account-limited',
        type: 'oauth',
        providerId: 'google-drive',
        accountScope: 'openid',
      },
    ])

    const input = { organizationId: 'org-1', type: 'oauth' as const, providerId: 'google-drive' }
    const result = await listOrganizationCredentials.execute({ principal, input })

    expect(result.credentials.map(({ id, scopes }) => ({ id, scopes }))).toEqual([
      {
        id: 'credential-full',
        scopes: ['drive.readonly', 'drive.metadata.readonly', 'openid'],
      },
      { id: 'credential-limited', scopes: ['openid'] },
    ])
    expect(result.credentials.every((item) => !Object.hasOwn(item, 'accountScope'))).toBe(true)
    expect(mocks.authorize).toHaveBeenCalledWith(
      principal,
      organizationCredentialOperations.list,
      input
    )
    expect(dbChainMockFns.leftJoin).toHaveBeenCalledWith(
      account,
      eq(credential.accountId, account.id)
    )
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(
        and(eq(credential.organizationId, 'org-1'), isNull(credential.workspaceId)),
        or(
          eq(credential.type, 'service_account'),
          and(eq(credential.type, 'oauth'), eq(credential.createdBy, 'admin-1'))
        ),
        eq(credential.type, 'oauth'),
        eq(credential.providerId, 'google-drive')
      )
    )
    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith(desc(credential.createdAt))
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1000)
  })

  it.each([null, '', '  \t\n '])(
    'does not invent grants when account scopes are %j',
    async (scope) => {
      mocks.catalog.mockResolvedValue([
        { type: 'oauth', available: true, authorizationOptions: [{ providerId: 'google-drive' }] },
      ])
      queueTableRows(credential, [
        { ...row, type: 'oauth', providerId: 'google-drive', accountScope: scope },
      ])

      const result = await listOrganizationCredentials.execute({
        principal,
        input: { organizationId: 'org-1', type: 'oauth' },
      })

      expect(result.credentials).toEqual([expect.objectContaining({ scopes: [] })])
    }
  )

  it('keeps service accounts in the general list and excludes unavailable providers', async () => {
    mocks.catalog.mockResolvedValue([
      { type: 'service_account', available: true, providerId: 'google-service-account' },
      { type: 'oauth', available: false, authorizationOptions: [{ providerId: 'google-drive' }] },
    ])
    queueTableRows(credential, [
      { ...row, accountScope: null },
      { ...row, id: 'hidden', type: 'oauth', providerId: 'google-drive', accountScope: 'openid' },
      { ...row, id: 'unknown', providerId: null, accountScope: null },
    ])

    const result = await listOrganizationCredentials.execute({
      principal,
      input: { organizationId: 'org-1' },
    })

    expect(result.credentials).toEqual([{ ...row, scopes: [] }])
  })

  it('refuses an unauthorized organization list before reading accounts or provider availability', async () => {
    mocks.authorize.mockRejectedValue(
      new OrchestrationError('forbidden', 'Organization administrator access is required')
    )

    await expect(
      listOrganizationCredentials.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('administrator')

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.catalog).not.toHaveBeenCalled()
  })
  it('creates a verified organization service account without a workspace identity', async () => {
    const input = {
      organizationId: 'org-1',
      type: 'service_account' as const,
      providerId: 'google-service-account',
      serviceAccountJson: '{}',
    }
    await createOrganizationCredential.execute({ principal, input })
    expect(mocks.create).toHaveBeenCalledWith(
      { ...input, userId: 'admin-1' },
      { authorizeWorkspace: false }
    )
    expect(mocks.requireService).toHaveBeenCalledWith([], 'google-service-account')
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        metadata: expect.objectContaining({ organizationId: 'org-1' }),
      })
    )
  })
  it('denies an ordinary member before checking provider secrets or writing a credential', async () => {
    mocks.authorize.mockRejectedValue(
      new OrchestrationError('forbidden', 'Organization administrator access is required')
    )
    await expect(
      createOrganizationCredential.execute({
        principal,
        input: {
          organizationId: 'org-1',
          type: 'service_account',
          providerId: 'google-service-account',
        },
      })
    ).rejects.toThrow('administrator')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.catalog).not.toHaveBeenCalled()
  })
  it('creates a draft bound to the acting admin and the organization', async () => {
    const input = { organizationId: 'org-1', providerId: 'google-drive', displayName: 'Drive' }
    await saveOrganizationCredentialDraft.execute({ principal, input })
    expect(mocks.draft).toHaveBeenCalledWith({ ...input, userId: 'admin-1' })
  })
  it('does not reconnect another member OAuth identity even for an organization admin', async () => {
    mocks.getCredential.mockResolvedValue({
      ...row,
      type: 'oauth',
      providerId: 'google-drive',
      createdBy: 'other-user',
    })
    await expect(
      saveOrganizationCredentialDraft.execute({
        principal,
        input: {
          organizationId: 'org-1',
          providerId: 'google-drive',
          displayName: 'Drive',
          credentialId: 'credential-1',
        },
      })
    ).rejects.toThrow('not found')
    expect(mocks.draft).not.toHaveBeenCalled()
  })
  it('rechecks role at launch rather than trusting a draft created before demotion', async () => {
    mocks.getDraft.mockResolvedValue({
      id: 'draft-1',
      organizationId: 'org-1',
      workspaceId: null,
      providerId: 'google-drive',
    })
    mocks.authorize.mockRejectedValue(new OrchestrationError('forbidden', 'Admin role was removed'))
    await expect(launchOrganizationCredentialConnection(principal, 'draft-1')).rejects.toThrow(
      'removed'
    )
    expect(mocks.catalog).not.toHaveBeenCalled()
  })
  it('refuses a missing cross-organization credential before resolving a token', async () => {
    mocks.getCredential.mockResolvedValue(null)
    await expect(
      resolveOrganizationCredentialTokenBundle({
        principal,
        organizationId: 'org-1',
        credentialId: 'other-org-credential',
        requestId: 'test',
      })
    ).rejects.toThrow('not found')
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })
  it('uses the existing service account minter after exact source-provider binding', async () => {
    await resolveOrganizationCredentialTokenBundle({
      principal,
      organizationId: 'org-1',
      credentialId: 'credential-1',
      requestId: 'test',
      expectedProviderId: 'google-drive',
      requiredScopes: ['drive.readonly'],
    })
    expect(mocks.resolveToken).toHaveBeenCalledWith(
      'credential-1',
      'admin-1',
      'test',
      ['drive.readonly'],
      undefined,
      { privacyMode: 'selector' }
    )
  })
  it('reuses the secret rotation manager with the canonical organization credential', async () => {
    await updateOrganizationCredential.execute({
      principal,
      input: { organizationId: 'org-1', credentialId: 'credential-1', description: 'Updated' },
    })
    expect(mocks.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialId: 'credential-1',
      description: 'Updated',
      credential: row,
    })
  })
})
