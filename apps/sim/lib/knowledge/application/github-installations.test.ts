/** @vitest-environment node */
import { db } from '@sim/db'
import { credential, credentialGroup, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  configuration: vi.fn(),
  list: vi.fn(),
  verify: vi.fn(),
  token: vi.fn(),
  encrypt: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    CREDENTIAL_CREATED: 'credential.created',
    CREDENTIAL_UPDATED: 'credential.updated',
  },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: m.audit,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: async ({ organizationId }: { organizationId: string }) => ({
    organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/oauth/github-installation', () => ({
  GitHubInstallationError: class extends Error {
    constructor(
      message: string,
      readonly status?: number
    ) {
      super(message)
    }
  },
  getGitHubInstallationConfiguration: m.configuration,
  listUserAdminGitHubInstallations: m.list,
  verifyGitHubInstallationBinding: m.verify,
}))
vi.mock('@/lib/credentials/managed-oauth', () => ({
  resolveManagedOAuthToken: m.token,
  ManagedOAuthCredentialError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly statusCode: number
    ) {
      super(message)
    }
  },
}))
vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({
    getPolicy: async () => ({ authorizationAppId: 'current-app', scopeVersion: 1 }),
  }),
}))
vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: m.encrypt }))

import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import {
  connectGitHubSearchInstallation,
  listGitHubSearchInstallations,
} from '@/lib/knowledge/application/github-installations'
import { GitHubInstallationError } from '@/lib/oauth/github-installation'

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const input = { organizationId: 'org', installationId: '42' }
const reader = { id: 'reader', authorizationAppId: 'current-app', groupId: 'group', subjectId: '9' }
const binding = {
  type: 'github_app_installation',
  version: 1,
  appId: '1',
  appClientId: 'client',
  installationId: '42',
  accountId: '7',
  accountLogin: 'example',
  accountType: 'Organization',
  repositorySelection: 'selected',
}
const connect = () => connectGitHubSearchInstallation.execute({ principal, input })

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  m.configuration.mockReturnValue({
    configured: true,
    installUrl: 'https://github.com/apps/example/installations/new',
  })
  m.list.mockResolvedValue([binding])
  m.token.mockResolvedValue({ accessToken: 'ghu_reader' })
  m.verify.mockResolvedValue(binding)
  m.encrypt.mockResolvedValue({ encrypted: 'encrypted-installation-binding' })
})
afterAll(resetDbChainMock)

function setupReader() {
  queueTableRows(member, [{ role: 'admin' }])
  queueTableRows(credential, [reader])
}
function setupTransaction(currentReader = reader, existing: { id: string }[] = []) {
  queueTableRows(member, [{ id: 'admin-membership' }])
  queueTableRows(credentialGroup, [{ id: 'group' }])
  queueTableRows(credential, [currentReader])
  queueTableRows(credential, existing)
}

describe('GitHub Search installation application operations', () => {
  it.each(['member', undefined])(
    'requires a current Sim organization admin before provider access: %s',
    async (role) => {
      queueTableRows(member, role ? [{ role }] : [])
      await expect(connect()).rejects.toMatchObject({ code: role ? 'forbidden' : 'not_found' })
      expect(m.token).not.toHaveBeenCalled()
      expect(m.verify).not.toHaveBeenCalled()
      expect(db.transaction).not.toHaveBeenCalled()
    }
  )
  it('refuses API keys for installation setup', async () => {
    await expect(
      connectGitHubSearchInstallation.execute({
        principal: { kind: 'personal_api_key', userId: 'admin', keyId: 'key' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(m.verify).not.toHaveBeenCalled()
  })
  it('reports unavailable configuration without exposing installations', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    m.configuration.mockReturnValue({ configured: false, installUrl: null })
    await expect(listGitHubSearchInstallations.execute({ principal, input })).resolves.toEqual({
      available: false,
      installUrl: null,
      needsUserConnection: false,
      installations: [],
    })
    expect(m.list).not.toHaveBeenCalled()
  })
  it('asks for the current admin’s own connection when none is available', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(credential, [])
    await expect(
      listGitHubSearchInstallations.execute({ principal, input })
    ).resolves.toMatchObject({ needsUserConnection: true, installations: [] })
    expect(m.token).not.toHaveBeenCalled()
  })
  it('uses only the organization-bound managed reader token to list installations', async () => {
    setupReader()
    const signal = new AbortController().signal
    await listGitHubSearchInstallations.execute({ principal, input: { ...input, signal } })
    expect(m.token).toHaveBeenCalledWith({
      credentialId: 'reader',
      organizationId: 'org',
      expectedProviderId: 'github-repositories',
      requiredScopes: [],
    })
    expect(m.list).toHaveBeenCalledWith('ghu_reader', { signal })
  })
  it('reenters reader OAuth when GitHub revoked a token still recorded as active', async () => {
    setupReader()
    m.list.mockRejectedValueOnce(new GitHubInstallationError('Bad credentials', 401))
    await expect(
      listGitHubSearchInstallations.execute({ principal, input })
    ).resolves.toMatchObject({
      needsUserConnection: true,
      installations: [],
    })
  })
  it('reenters reader OAuth when token refresh detects a revoked grant', async () => {
    setupReader()
    m.token.mockRejectedValueOnce(
      new ManagedOAuthCredentialError(
        'MANAGED_CREDENTIAL_NEEDS_REAUTH',
        'Refresh grant revoked',
        401
      )
    )
    await expect(
      listGitHubSearchInstallations.execute({ principal, input })
    ).resolves.toMatchObject({
      needsUserConnection: true,
      installations: [],
    })
    expect(m.list).not.toHaveBeenCalled()
  })
  it('preserves provider infrastructure failures during discovery', async () => {
    setupReader()
    const error = new GitHubInstallationError('Provider unavailable', 503)
    m.list.mockRejectedValueOnce(error)
    await expect(listGitHubSearchInstallations.execute({ principal, input })).rejects.toBe(error)
  })
  it('preserves transient token refresh failures instead of requesting OAuth', async () => {
    setupReader()
    const error = new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_REFRESH_FAILED',
      'Transient refresh error',
      502
    )
    m.token.mockRejectedValueOnce(error)
    await expect(listGitHubSearchInstallations.execute({ principal, input })).rejects.toBe(error)
  })
  it('does not reclassify App JWT authorization failures during installation verification', async () => {
    setupReader()
    const error = new GitHubInstallationError('App JWT rejected', 401)
    m.verify.mockRejectedValueOnce(error)
    await expect(connect()).rejects.toBe(error)
    expect(m.encrypt).not.toHaveBeenCalled()
  })
  it('reverifies GitHub admin authority before persisting an installation', async () => {
    setupReader()
    m.verify.mockRejectedValue(new Error('GitHub administrator access required'))
    await expect(connect()).rejects.toThrow('GitHub administrator access required')
    expect(m.encrypt).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })
  it('persists an encrypted installation binding and grants management to the actual admin', async () => {
    setupReader()
    setupTransaction()
    const result = await connect()
    expect(result).toMatchObject({
      created: true,
      credential: { displayName: 'example' },
    })
    expect(m.verify).toHaveBeenCalledWith('ghu_reader', '42', { signal: undefined })
    expect(m.encrypt).toHaveBeenCalledWith(JSON.stringify(binding))
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        workspaceId: null,
        providerId: 'github-app-installation',
        type: 'service_account',
        createdBy: 'admin',
        encryptedServiceAccountKey: 'encrypted-installation-binding',
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: result.credential.id,
        userId: 'admin',
        role: 'admin',
        status: 'active',
      })
    )
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin',
        resourceId: result.credential.id,
        action: 'credential.created',
      })
    )
  })
  it('reuses the same installation credential on repeat setup', async () => {
    setupReader()
    setupTransaction(reader, [{ id: 'existing' }])
    await expect(connect()).resolves.toMatchObject({
      created: false,
      credential: { id: 'existing' },
    })
  })
  it('refuses if Sim administrator access was removed during GitHub verification', async () => {
    setupReader()
    queueTableRows(member, [])
    await expect(connect()).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
  it('refuses if the reader identity changed during GitHub verification', async () => {
    setupReader()
    setupTransaction({ ...reader, subjectId: 'different-person' })
    await expect(connect()).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
})
