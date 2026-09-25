import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  githubInstallationMock,
  githubInstallationMockFns,
} from '@sim/testing/mocks/github-installation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  access: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/connector-credential', () => ({
  requireConnectorCredential: hoisted.access,
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/oauth/github-installation', () => githubInstallationMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { prepareGitHubInstallationSource } from '@/lib/knowledge/application/github-installation-source'

const m = {
  ...hoisted,
  parse: githubInstallationMockFns.mockParseGitHubInstallationBinding,
  repository: githubInstallationMockFns.mockResolveGitHubInstallationRepository,
}

const installed = {
  id: 'installation-credential',
  providerId: 'github-app-installation',
  organizationId: 'org',
  workspaceId: null,
  type: 'service_account',
  revokedAt: null,
  encryptedServiceAccountKey: 'encrypted-binding',
  providerSubjectId: '42',
  providerTenantId: '7',
}
const input = {
  principal: createSessionPrincipal({ userId: 'admin', sessionId: 'session' }),
  requestId: 'request',
  connectorType: 'github',
  credentialId: installed.id,
  organizationId: 'org',
  isSearchIndex: true,
  accessMode: 'members',
  actingUserId: 'admin',
  sourceConfig: { repository: 'example/private' },
}

beforeEach(() => {
  m.access.mockResolvedValue(installed)
  encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: '{}' })
  m.parse.mockReturnValue({ installationId: '42', accountId: '7' })
  m.repository.mockResolvedValue({ id: '123', fullName: 'example/private', defaultBranch: 'main' })
})

describe('GitHub installation source identity', () => {
  it('persists only the provider-attested repository ID even when the browser supplies another', async () => {
    await expect(
      prepareGitHubInstallationSource({
        ...input,
        sourceConfig: { ...input.sourceConfig, githubRepositoryId: '999' },
      })
    ).resolves.toEqual({ repository: 'example/private', githubRepositoryId: '123' })
    expect(m.access).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: input.principal,
        credentialId: installed.id,
        scope: { kind: 'organization', organizationId: 'org' },
      })
    )
  })
  it.each([
    { organizationId: undefined, workspaceId: 'workspace' },
    { isSearchIndex: false },
    { accessMode: 'admin' },
    { accessMode: 'workspace' },
  ])('requires organization Search and member access: %j', async (change) => {
    await expect(prepareGitHubInstallationSource({ ...input, ...change })).rejects.toMatchObject({
      code: 'validation',
    })
    expect(m.repository).not.toHaveBeenCalled()
  })
  it.each([
    { organizationId: 'other-org' },
    { workspaceId: 'workspace' },
    { type: 'oauth' },
    { revokedAt: new Date() },
    { encryptedServiceAccountKey: null },
  ])('refuses unusable or cross-scope installation credentials: %j', async (change) => {
    m.access.mockResolvedValue({ ...installed, ...change })
    await expect(prepareGitHubInstallationSource(input)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
  it('refuses credentials the acting user cannot use', async () => {
    m.access.mockRejectedValue(new OrchestrationError('forbidden', 'Credential access denied'))
    await expect(prepareGitHubInstallationSource(input)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
  it('bounds encrypted binding data before decryption', async () => {
    m.access.mockResolvedValue({ ...installed, encryptedServiceAccountKey: 'x'.repeat(16_385) })
    await expect(prepareGitHubInstallationSource(input)).rejects.toMatchObject({
      code: 'validation',
    })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })
  it('refuses mismatched installation identity', async () => {
    m.parse.mockReturnValue({ installationId: 'evil', accountId: '7' })
    await expect(prepareGitHubInstallationSource(input)).rejects.toMatchObject({
      code: 'validation',
    })
    expect(m.repository).not.toHaveBeenCalled()
  })
  it('refuses repository replacement while allowing a rename of the same immutable repository', async () => {
    await expect(
      prepareGitHubInstallationSource({ ...input, previousConfig: { githubRepositoryId: '456' } })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      prepareGitHubInstallationSource({
        ...input,
        previousConfig: { repository: 'old/name', githubRepositoryId: '123' },
      })
    ).resolves.toMatchObject({ githubRepositoryId: '123' })
  })
  it.each([null, { providerId: 'github-repositories' }])(
    'cannot downgrade an existing installation by replacing or deleting its credential',
    async (access) => {
      m.access.mockResolvedValue(access)
      await expect(
        prepareGitHubInstallationSource({ ...input, previousConfig: { githubRepositoryId: '123' } })
      ).rejects.toMatchObject({ code: 'validation' })
    }
  )
  it('does not accept the installation marker on ordinary member setup', async () => {
    await expect(
      prepareGitHubInstallationSource({
        ...input,
        credentialId: undefined,
        sourceConfig: { ...input.sourceConfig, githubRepositoryId: '123' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
  it('propagates a provider denial without producing a source binding', async () => {
    m.repository.mockRejectedValue(new Error('Repository access denied'))
    await expect(prepareGitHubInstallationSource(input)).rejects.toThrow('Repository access denied')
  })
})
