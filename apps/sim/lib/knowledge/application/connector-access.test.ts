/** @vitest-environment node */
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
  }),
}))

vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  sourceIdentityBinding: mocks.identityBinding,
  provisionKnowledgeConnectorMembersBinding: mocks.provision,
}))

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
  vi.clearAllMocks()
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
})

describe('source member enrollment', () => {
  it.each(['admin', 'members'])(
    'focuses a Search %s source on its exact validated account option',
    async (accessMode) => {
      mocks.context.mockResolvedValue({
        workspaceId: 'workspace',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        knowledgeBaseId: 'kb',
        connectorId: 'source',
        knowledgeBase: { workspaceId: 'workspace', id: 'kb', name: 'Search', isSearchIndex: true },
      })
      mocks.connector.mockResolvedValue({
        ...row,
        connectorType: 'confluence',
        accessMode,
        credentialGroupId: 'group',
        credentialGroupOptionId: 'source-option-two',
      })
      mocks.meta.mockReturnValue({ name: 'Confluence', search: true, requiresMemberIdentity: true })
      mocks.identityBinding.mockReturnValue({
        credentialGroupId: 'accounts',
        credentialGroupOptionId: 'identity-option-two',
      })
      const { url } = await startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
      expect(new URL(url).searchParams.get('optionId')).toBe(
        accessMode === 'admin' ? 'identity-option-two' : 'source-option-two'
      )
      expect(new URL(url).searchParams.get('returnTo')).toBe('search')
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.provision).not.toHaveBeenCalled()
    }
  )

  it('lets a reader connect only their identity for a configured mirrored source without creating a crawler binding', async () => {
    mocks.role.mockResolvedValue('read')
    mocks.connector.mockResolvedValue({ ...row, accessMode: 'admin', connectorType: 'confluence' })
    mocks.meta.mockReturnValue({
      name: 'Confluence',
      mirrorsSourceAcls: true,
      requiresMemberIdentity: true,
    })
    mocks.identityBinding.mockReturnValue({
      credentialGroupId: 'accounts',
      credentialGroupOptionId: 'confluence',
    })
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
    ).resolves.toEqual({ url: 'https://fixture.test/enroll' })
    expect(mocks.loadWorkspaceAccounts).toHaveBeenCalledExactlyOnceWith({
      kind: 'workspace',
      workspaceId: 'workspace',
    })
    expect(mocks.enrollment).toHaveBeenCalledExactlyOnceWith({
      userId: 'admin',
      workspaceId: 'workspace',
      credentialGroupId: 'accounts',
    })
    expect(mocks.binding).not.toHaveBeenCalled()
    expect(mocks.provision).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
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

  it('does not mint a link for a disabled or incompatible provider option', async () => {
    mocks.connector.mockResolvedValue({
      ...row,
      accessMode: 'members',
      credentialGroupId: 'group',
      credentialGroupOptionId: 'option',
    })
    mocks.validateBinding.mockReturnValueOnce({
      ok: false,
      message: 'Credential option collects a different provider',
    })
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
    ).rejects.toThrow('different provider')
    expect(mocks.enrollment).not.toHaveBeenCalled()
  })

  it('does not provision a group when the stored option is missing', async () => {
    mocks.connector.mockResolvedValue({ ...row, accessMode: 'members', credentialGroupId: 'group' })
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.binding).not.toHaveBeenCalled()
    expect(mocks.enrollment).not.toHaveBeenCalled()
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

  it('validates the canonical stored API key before enabling source mirroring', async () => {
    await updateKnowledgeConnectorAccess.execute({
      principal,
      input: { ...input, accessMode: 'admin' },
    })
    expect(mocks.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        actingUserId: 'admin',
        workspaceId: 'workspace',
        connector: expect.objectContaining({
          encryptedApiKey: 'encrypted-fixture',
          credentialId: null,
          accessMode: 'admin',
        }),
      })
    )
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ target: { accessMode: 'admin', credentialId: null } })
    )
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

  it('requires a usable OAuth credential when leaving member access', async () => {
    mocks.meta.mockReturnValue({ name: 'Drive', auth: { mode: 'oauth', provider: 'google-drive' } })
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal,
        input: { ...input, accessMode: 'workspace' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.update).not.toHaveBeenCalled()
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

  it('preserves a dedicated content credential on rebind and validates its use', async () => {
    mocks.meta.mockReturnValue({
      name: 'Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      supportsSeparateContentCredential: true,
    })
    mocks.connector.mockResolvedValue({
      ...row,
      connectorType: 'google_drive',
      accessMode: 'members',
      credentialId: 'service-account',
    })
    await updateKnowledgeConnectorAccess.execute({
      principal,
      input: { ...input, accessMode: 'members' },
    })
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'service-account', actingUserId: 'admin' })
    )
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ accessMode: 'members', credentialId: 'service-account' }),
      })
    )
  })

  it('requires explicit null to remove the dedicated content credential', async () => {
    mocks.meta.mockReturnValue({
      name: 'Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      supportsSeparateContentCredential: true,
    })
    mocks.connector.mockResolvedValue({
      ...row,
      accessMode: 'members',
      credentialId: 'service-account',
    })
    await updateKnowledgeConnectorAccess.execute({
      principal,
      input: { ...input, accessMode: 'members', credentialId: null },
    })
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ accessMode: 'members', credentialId: null }),
      })
    )
  })
})
