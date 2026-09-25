import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  role: vi.fn(),
  connector: vi.fn(),
  meta: vi.fn(),
  validate: vi.fn(),
  token: vi.fn(),
  binding: vi.fn(),
  loadGroup: vi.fn(),
  validateBinding: vi.fn(),
  update: vi.fn(),
  mirror: vi.fn(),
  enrollment: vi.fn(),
  loadWorkspaceAccounts: vi.fn(),
  identityBinding: vi.fn(),
  provision: vi.fn(),
  memberAccess: vi.fn(),
  sourceAccess: vi.fn(),
  oauthContext: vi.fn(),
  startOAuth: vi.fn(),
  authorizeOrganization: vi.fn(),
  credential: vi.fn(),
  decrypt: vi.fn(),
  installationBinding: vi.fn(),
  repository: vi.fn(),
}))

vi.mock('@sim/audit', () => ({ AuditAction: {}, AuditResourceType: {}, recordAudit: vi.fn() }))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required,
  resolveEffectiveWorkspacePermission: mocks.role,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: async () => null,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorizeOrganization,
}))
vi.mock('@/lib/knowledge/application/connector-credential', () => ({
  requireConnectorCredential: mocks.credential,
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/oauth/github-installation', () => ({
  GitHubInstallationError: class extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly operation?: string
    ) {
      super(message)
    }
  },
  parseGitHubInstallationBinding: mocks.installationBinding,
  resolveGitHubInstallationRepository: mocks.repository,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveActiveKnowledgeConnectorContext: mocks.context,
}))
vi.mock('@/connectors/registry', () => ({ getConnectorMeta: mocks.meta }))
vi.mock('@/lib/knowledge/connectors/mirrored-access', () => ({
  assertConnectorMirrorsSourceAcls: mocks.mirror,
}))
vi.mock('@/lib/knowledge/application/connectors', () => ({
  requireConnectorWorkspaceId: (context: { workspaceId: string }) => context.workspaceId,
  requireSuccessfulOutcome: vi.fn(),
  resolveConnectorCredentialAccessToken: mocks.token,
  validateConnectorSourceConfig: mocks.validate,
}))
vi.mock('@/lib/knowledge/orchestration/connectors', () => ({
  getKnowledgeConnector: mocks.connector,
}))
vi.mock('@/lib/knowledge/orchestration/connector-access', () => ({
  resolveKnowledgeConnectorMembersBinding: mocks.binding,
  performUpdateKnowledgeConnectorAccess: mocks.update,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireKnowledgeMemberAccessAvailable: mocks.memberAccess,
  requireSourceMirroredAccessAvailable: mocks.sourceAccess,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadCredentialGroupCredentialListContext: mocks.loadGroup,
  loadScopedAccountsCredentialListContext: (scope: unknown, groupId?: string) =>
    groupId ? mocks.loadGroup(groupId) : mocks.loadWorkspaceAccounts(scope),
}))
vi.mock('@/lib/knowledge/connectors/member-access', () => ({
  validateKnowledgeConnectorMembersBinding: mocks.validateBinding,
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: async (...args: unknown[]) => ({
    invitationLink: await mocks.enrollment(...args),
    enrollment: { id: 'enrollment', email: 'person@example.test' },
  }),
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContextForEnrollment: mocks.oauthContext,
}))
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: mocks.startOAuth }))

vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  sourceIdentityBinding: mocks.identityBinding,
  provisionKnowledgeConnectorMembersBinding: mocks.provision,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  startKnowledgeConnectorMemberEnrollment,
  updateKnowledgeConnectorAccess,
} from '@/lib/knowledge/application/connector-access'

const principal = { kind: 'session' as const, userId: 'admin', sessionId: 'session' }
const input = { knowledgeBaseId: 'kb', connectorId: 'source', assertedWorkspaceId: 'workspace' }
const row = {
  id: 'source',
  connectorType: 'gitlab',
  knowledgeBaseId: 'kb',
  accessMode: 'workspace',
  credentialId: null,
  encryptedApiKey: 'encrypted-fixture',
  sourceConfig: { host: 'gitlab.example.test', project: 'one' },
}

beforeEach(() => {
  mocks.context.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'payer',
    knowledgeBaseId: 'kb',
    connectorId: 'source',
    knowledgeBase: { workspaceId: 'workspace', id: 'kb', name: 'Search' },
  })
  mocks.role.mockResolvedValue('admin')
  mocks.connector.mockResolvedValue(row)
  mocks.meta.mockReturnValue({ name: 'GitLab', auth: { mode: 'apiKey' }, mirrorsSourceAcls: true })
  mocks.validate.mockResolvedValue(null)
  mocks.token.mockResolvedValue({ accessToken: 'provider-fixture' })
  mocks.binding.mockResolvedValue({
    credentialGroupId: 'group',
    credentialGroupOptionId: 'option',
    sourceConfig: {},
  })
  mocks.update.mockResolvedValue({ success: true, changed: false, connector: row })
  mocks.enrollment.mockResolvedValue('https://fixture.test/enroll')
  mocks.loadGroup.mockResolvedValue({ credentialGroupId: 'group', workspaceId: 'workspace' })
  mocks.validateBinding.mockReturnValue({ ok: true })
  mocks.loadWorkspaceAccounts.mockResolvedValue({
    credentialGroupId: 'accounts',
    workspaceId: 'workspace',
  })
  mocks.identityBinding.mockReturnValue(null)
  mocks.memberAccess.mockResolvedValue(undefined)
  mocks.sourceAccess.mockResolvedValue(undefined)
  mocks.oauthContext.mockResolvedValue({ credentialOwnerId: 'admin', option: { id: 'option' } })
  mocks.startOAuth.mockResolvedValue('https://provider.example.test/authorize')
  mocks.authorizeOrganization.mockResolvedValue({
    organizationId: 'org',
    userId: 'admin',
    role: 'admin',
  })
})

describe('GitHub installation connection replacement', () => {
  const sourceConfig = { repository: 'acme/platform', githubRepositoryId: '123', branch: 'main' }
  const replacementInput = {
    knowledgeBaseId: 'kb',
    connectorId: 'source',
    accessMode: 'members' as const,
    credentialId: 'replacement-installation',
  }

  beforeEach(() => {
    mocks.context.mockResolvedValue({
      organizationId: 'org',
      knowledgeBaseId: 'kb',
      connectorId: 'source',
      knowledgeBase: { organizationId: 'org', id: 'kb', name: 'Search', isSearchIndex: true },
    })
    mocks.connector.mockResolvedValue({
      ...row,
      connectorType: 'github',
      accessMode: 'members',
      credentialId: 'previous-installation',
      sourceConfig,
    })
    mocks.meta.mockReturnValue({
      name: 'GitHub',
      search: true,
      auth: { mode: 'oauth', provider: 'github-repositories' },
      supportsSeparateContentCredential: true,
    })
    mocks.credential.mockResolvedValue({
      id: replacementInput.credentialId,
      providerId: 'github-app-installation',
      organizationId: 'org',
      workspaceId: null,
      type: 'service_account',
      revokedAt: null,
      encryptedServiceAccountKey: 'encrypted-binding',
      providerSubjectId: '42',
      providerTenantId: '7',
    })
    mocks.decrypt.mockResolvedValue({ decrypted: '{}' })
    mocks.installationBinding.mockReturnValue({ installationId: '42', accountId: '7' })
    mocks.repository.mockResolvedValue({ id: '123', fullName: 'acme/platform' })
    mocks.binding.mockImplementation(async ({ sourceConfig }) => ({
      credentialGroupId: 'group',
      credentialGroupOptionId: 'github-members',
      sourceConfig,
    }))
  })

  it('rejects a recreated repository at the same path before changing the binding', async () => {
    mocks.repository.mockResolvedValue({ id: '999', fullName: 'acme/platform' })
    await expect(
      updateKnowledgeConnectorAccess.execute({ principal, input: replacementInput })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Create a new source to index a different GitHub repository',
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rechecks organization administration before reading the installation or mutating the source', async () => {
    mocks.authorizeOrganization.mockRejectedValue(
      new OrchestrationError('forbidden', 'Organization administrator access is required')
    )
    await expect(
      updateKnowledgeConnectorAccess.execute({ principal, input: replacementInput })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.repository).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe('source member enrollment', () => {
  it('rejects direct OAuth for a non-Search source before creating an enrollment', async () => {
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({
        principal,
        input: { ...input, oauthCompletionId: '550e8400-e29b-41d4-a716-446655440000' },
      })
    ).rejects.toThrow('requires a Search source')
    expect(mocks.enrollment).not.toHaveBeenCalled()
    expect(mocks.startOAuth).not.toHaveBeenCalled()
  })

  it('refuses a mirrored source without a configured active identity option', async () => {
    mocks.connector.mockResolvedValue({ ...row, accessMode: 'admin' })
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
    ).rejects.toThrow('configure GitLab sign-in')
    expect(mocks.enrollment).not.toHaveBeenCalled()
    expect(mocks.provision).not.toHaveBeenCalled()
  })

  it('keeps source-mirroring feature checks on identity enrollment', async () => {
    mocks.connector.mockResolvedValue({ ...row, accessMode: 'admin' })
    mocks.sourceAccess.mockRejectedValueOnce(new Error('Mirroring unavailable'))
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
    ).rejects.toThrow('Mirroring unavailable')
    expect(mocks.enrollment).not.toHaveBeenCalled()
    expect(mocks.loadWorkspaceAccounts).not.toHaveBeenCalled()
  })
  it('revalidates the exact stored option and source settings before minting a link', async () => {
    mocks.connector.mockResolvedValue({
      ...row,
      accessMode: 'members',
      credentialGroupId: 'group',
      credentialGroupOptionId: 'option',
    })
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
    ).resolves.toEqual({ url: 'https://fixture.test/enroll' })
    expect(mocks.loadGroup).toHaveBeenCalledWith('group')
    expect(mocks.validateBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialGroupOptionId: 'option',
        sourceConfig: row.sourceConfig,
      })
    )
    expect(mocks.binding).not.toHaveBeenCalled()
  })
})

describe('connector access application boundary', () => {
  it('refuses making a canonical Search source visible to the whole workspace', async () => {
    mocks.context.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      knowledgeBaseId: 'kb',
      connectorId: 'source',
      knowledgeBase: { workspaceId: 'workspace', id: 'kb', name: 'Search', isSearchIndex: true },
    })
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: { ...input, accessMode: 'workspace' },
      })
    ).rejects.toThrow('Search sources must support')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does not mutate access when the source refuses the configured token', async () => {
    mocks.validate.mockResolvedValue({
      errorCode: 'validation',
      message: 'An instance administrator is required',
    })
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: { ...input, accessMode: 'admin' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does not interpret a supplied OAuth credential as an API key', async () => {
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: { ...input, accessMode: 'admin', credentialId: 'unrelated-credential' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('requires the actual workspace administrator before reading a source credential', async () => {
    mocks.role.mockResolvedValue('read')
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: { ...input, accessMode: 'admin' },
      })
    ).rejects.toThrow()
    expect(mocks.connector).not.toHaveBeenCalled()
    expect(mocks.validate).not.toHaveBeenCalled()
  })

  it('rejects separate content credentials for providers without the capability', async () => {
    mocks.meta.mockReturnValue({
      name: 'Confluence',
      auth: { mode: 'oauth', provider: 'confluence' },
    })
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: { ...input, accessMode: 'members', credentialId: 'service-account' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe('account and settings save', () => {
  it('leaves both account and settings unchanged when provider validation rejects the replacement', async () => {
    mocks.connector.mockResolvedValue({ ...row, accessMode: 'admin' })
    mocks.validate.mockResolvedValue({
      errorCode: 'validation',
      message: 'Cannot access this space',
    })
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: {
          ...input,
          accessMode: 'admin',
          sourceConfig: { host: 'new.example.test' },
        },
      })
    ).rejects.toThrow('Cannot access this space')
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
