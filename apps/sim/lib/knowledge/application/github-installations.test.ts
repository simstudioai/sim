import { db } from '@sim/db'
import { credential, credentialGroup, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  credentialGroupsProvidersMock,
  credentialGroupsProvidersMockFns,
} from '@sim/testing/mocks/credential-groups-providers.mock'
import {
  credentialsManagedOauthMock,
  credentialsManagedOauthMockFns,
} from '@sim/testing/mocks/credentials-managed-oauth.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  githubInstallationMock,
  githubInstallationMockFns,
} from '@sim/testing/mocks/github-installation.mock'
import { knowledgeAvailabilityMock } from '@sim/testing/mocks/knowledge-availability.mock'
import { knowledgeContextsMock } from '@sim/testing/mocks/knowledge-contexts.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/oauth/github-installation', () => githubInstallationMock)
vi.mock('@/lib/credentials/managed-oauth', () => credentialsManagedOauthMock)
vi.mock('@/lib/credential-groups/provider-registry', () => credentialGroupsProvidersMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import {
  connectGitHubSearchInstallation,
  listGitHubSearchInstallations,
} from '@/lib/knowledge/application/github-installations'
import { GitHubInstallationError } from '@/lib/oauth/github-installation'

const m = {
  configuration: githubInstallationMockFns.mockGetGitHubInstallationConfiguration,
  list: githubInstallationMockFns.mockListUserAdminGitHubInstallations,
  verify: githubInstallationMockFns.mockVerifyGitHubInstallationBinding,
  token: credentialsManagedOauthMockFns.mockResolveManagedOAuthToken,
}

credentialGroupsProvidersMockFns.mockGetCredentialGroupProviderAdapter.mockReturnValue({
  getPolicy: async () => ({ authorizationAppId: 'current-app', scopeVersion: 1 }),
})

const principal = createSessionPrincipal({ userId: 'admin', sessionId: 'session' })
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
  resetDbChainMock()
  m.configuration.mockReturnValue({
    configured: true,
    installUrl: 'https://github.com/apps/example/installations/new',
  })
  m.list.mockResolvedValue([binding])
  m.token.mockResolvedValue({ accessToken: 'ghu_reader' })
  m.verify.mockResolvedValue(binding)
  encryptionMockFns.mockEncryptSecret.mockResolvedValue({
    encrypted: 'encrypted-installation-binding',
  })
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
        principal: createPersonalApiKeyPrincipal({ userId: 'admin', keyId: 'key' }),
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
  it('reports missing app membership access without requesting another OAuth connection', async () => {
    setupReader()
    m.list.mockRejectedValueOnce(
      new GitHubInstallationError(
        'Approve Organization Members read-only access',
        403,
        'membership-permissions'
      )
    )
    await expect(listGitHubSearchInstallations.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'validation',
        message: 'Approve Organization Members read-only access',
      }
    )
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
  it('reverifies GitHub admin authority before persisting an installation', async () => {
    setupReader()
    m.verify.mockRejectedValue(new Error('GitHub administrator access required'))
    await expect(connect()).rejects.toThrow('GitHub administrator access required')
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
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
