/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { credential, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  catalog: vi.fn(),
  requireService: vi.fn(),
  requireOAuth: vi.fn(),
  repository: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.catalog,
  requireAvailableServiceAccountCredentialProvider: mocks.requireService,
  requireAvailableOAuthCredentialProvider: mocks.requireOAuth,
}))
vi.mock('@/lib/credentials/application/credential-crud', () => ({
  throwCredentialMutationFailure: vi.fn(),
}))
vi.mock('@/lib/credentials/orchestration/credential-create', () => ({
  createCredentialRecord: vi.fn(),
}))
vi.mock('@/lib/credentials/orchestration', () => ({ updateCredentialRecord: vi.fn() }))
vi.mock('@/lib/credentials/connect-draft', () => ({
  createConnectDraft: vi.fn(),
  getActiveConnectDraft: vi.fn(),
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveCredentialTokenBundle: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: async () => ({ decrypted: '{}' }),
}))
vi.mock('@/lib/oauth/github-installation', () => ({
  parseGitHubInstallationBinding: () => ({ installationId: '42', accountId: '7' }),
  resolveGitHubInstallationRepository: mocks.repository,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireConnectorCredential } from '@/lib/knowledge/application/connector-credential'
import { prepareGitHubInstallationSource } from '@/lib/knowledge/application/github-installation-source'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const principal: Principal = { kind: 'session', userId: 'admin-1', sessionId: 'session-1' }
const installed = {
  id: 'installation-credential',
  organizationId: 'org-1',
  workspaceId: null,
  type: 'service_account',
  providerId: 'github-app-installation',
  createdBy: 'installer-1',
  revokedAt: null,
  encryptedServiceAccountKey: 'encrypted',
  providerSubjectId: '42',
  providerTenantId: '7',
}
const input = {
  principal,
  credentialId: installed.id,
  scope: { kind: 'organization' as const, organizationId: 'org-1' },
  actingUserId: 'admin-1',
  requestId: 'request-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
  mocks.catalog.mockResolvedValue([])
  mocks.repository.mockResolvedValue({ id: '123', fullName: 'example/private' })
})

describe('organization source credential authorization', () => {
  it.each(['owner', 'admin'])('pins an installation repository for a current %s', async (role) => {
    queueTableRows(member, [{ role }])
    queueTableRows(credential, [installed])

    await expect(
      prepareGitHubInstallationSource({
        principal,
        requestId: input.requestId,
        connectorType: 'github',
        credentialId: installed.id,
        organizationId: 'org-1',
        isSearchIndex: true,
        accessMode: 'members',
        actingUserId: 'admin-1',
        sourceConfig: { repository: 'example/private' },
      })
    ).resolves.toEqual({ repository: 'example/private', githubRepositoryId: '123' })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(eq(member.organizationId, 'org-1'), eq(member.userId, 'admin-1'))
    )
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(
        eq(credential.id, installed.id),
        and(eq(credential.organizationId, 'org-1'), isNull(credential.workspaceId))
      )
    )
    expect(mocks.requireService).toHaveBeenCalledWith([], 'github-app-installation')
  })

  it.each([{ rows: [] }, { rows: [{ role: 'member' }] }])(
    'refuses missing or insufficient membership: %j',
    async ({ rows }) => {
      queueTableRows(member, rows)
      queueTableRows(credential, [installed])
      await expect(requireConnectorCredential(input)).rejects.toBeInstanceOf(OrchestrationError)
      expect(dbChainMockFns.from).not.toHaveBeenCalledWith(credential)
      expect(mocks.catalog).not.toHaveBeenCalled()
    }
  )

  it('does not substitute the credential creator or attributed user for the principal', async () => {
    queueTableRows(member, [])
    await expect(
      requireConnectorCredential({ ...input, actingUserId: installed.createdBy })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(eq(member.organizationId, 'org-1'), eq(member.userId, principal.userId))
    )
  })

  it('refuses a credential outside the asserted organization', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(credential, [])
    await expect(requireConnectorCredential(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.catalog).not.toHaveBeenCalled()
  })

  it('does not make an organization credential usable from a workspace', async () => {
    queueTableRows(credential, [installed])
    await expect(
      requireConnectorCredential({ ...input, scope: { kind: 'workspace', workspaceId: 'ws-1' } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.catalog).not.toHaveBeenCalled()
  })

  it('refuses revoked credentials before provider access', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(credential, [{ ...installed, revokedAt: new Date() }])
    await expect(requireConnectorCredential(input)).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.catalog).not.toHaveBeenCalled()
  })

  it('does not let an admin use another person’s OAuth account', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(credential, [{ ...installed, type: 'oauth', providerId: 'github-repositories' }])
    await expect(requireConnectorCredential(input)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('allows an admin to use their own organization OAuth account', async () => {
    const ownAccount = {
      ...installed,
      type: 'oauth',
      providerId: 'github-repositories',
      createdBy: 'admin-1',
    }
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(credential, [ownAccount])
    await expect(requireConnectorCredential(input)).resolves.toEqual(ownAccount)
    expect(mocks.requireOAuth).toHaveBeenCalledWith([], 'github-repositories')
  })

  it('enforces the existing integration-management capability', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.config.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideIntegrationsTab: true,
    })
    await expect(requireConnectorCredential(input)).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(credential)
  })

  it('refuses workspace keys before protected loading', async () => {
    await expect(
      requireConnectorCredential({
        ...input,
        principal: { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'key-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.from).not.toHaveBeenCalled()
  })

  it('propagates provider policy denials', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(credential, [installed])
    const denial = new OrchestrationError('forbidden', 'Provider is unavailable')
    mocks.requireService.mockImplementationOnce(() => {
      throw denial
    })
    await expect(requireConnectorCredential(input)).rejects.toBe(denial)
  })
})
