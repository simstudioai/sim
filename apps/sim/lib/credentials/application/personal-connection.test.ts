/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  permission: vi.fn(),
  catalog: vi.fn(),
  group: vi.fn(),
  ensure: vi.fn(),
  enroll: vi.fn(),
  personal: vi.fn(),
  oauthContext: vi.fn(),
  startOAuth: vi.fn(),
  organizationMembership: vi.fn(),
  available: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' ||
    permission === required ||
    (permission === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.catalog,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  requireOrganizationMembership: mocks.organizationMembership,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.policy,
  ResourcePolicyNotFoundError: class extends Error {},
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContextForEnrollment: mocks.oauthContext,
}))
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: mocks.startOAuth }))
vi.mock('@/lib/credential-groups/service', () => ({ ensureWorkspaceAccountsGroup: mocks.ensure }))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: mocks.enroll,
}))
vi.mock('@/lib/credentials/personal', () => ({ getPersonalOAuthCredentials: mocks.personal }))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))

import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { startPersonalCredentialConnection } from '@/lib/credentials/application/personal-connection'

const principal: Principal = { kind: 'session', userId: 'viewer', sessionId: 'session' }
const input = { workspaceId: 'workspace', providerId: 'confluence' }
const group = {
  credentialGroupId: 'canonical-group',
  workspaceId: null,
  organizationId: 'organization',
  status: 'active',
  options: [{ id: 'option', provider: 'confluence', status: 'active' }],
}

function execute(overrides = {}) {
  return startPersonalCredentialConnection.execute({ principal, input: { ...input, ...overrides } })
}

describe('personal connection launch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: 'organization',
      allowPersonalApiKeys: true,
    })
    mocks.permission.mockResolvedValue('read')
    mocks.organizationMembership.mockResolvedValue({ userId: 'viewer', role: 'member' })
    mocks.available.mockResolvedValue(true)
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('canonical-group', ['workspace']),
    })
    mocks.catalog.mockResolvedValue([
      {
        type: 'oauth',
        available: true,
        name: 'Confluence',
        authorizationOptions: [{ providerId: 'confluence' }],
      },
    ])
    mocks.group.mockResolvedValue(group)
    mocks.personal.mockResolvedValue([])
    mocks.oauthContext.mockResolvedValue({ enrollmentId: 'enrollment', option: { id: 'option' } })
    mocks.startOAuth.mockResolvedValue('https://accounts.example.com/authorize?state=one-use')
    mocks.enroll.mockResolvedValue({
      invitationLink: 'https://sim.test/credential-groups/enroll/opaque-token',
      enrollment: { id: 'enrollment', email: 'viewer@example.com' },
    })
  })

  it('enrolls a reader as themselves in the canonical group without setting up an index', async () => {
    expect(await execute()).toEqual({
      providerId: 'confluence',
      url: 'https://accounts.example.com/authorize?state=one-use',
    })
    expect(mocks.oauthContext).toHaveBeenCalledWith(
      {
        organizationId: 'organization',
        credentialGroupId: 'canonical-group',
        enrollmentId: 'enrollment',
        email: 'viewer@example.com',
      },
      'option'
    )
    expect(mocks.startOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 'enrollment' }),
      'opaque-token',
      { completionRedirect: true }
    )
    expect(mocks.enroll).toHaveBeenCalledWith({
      userId: 'viewer',
      organizationId: 'organization',
      credentialGroupId: 'canonical-group',
    })
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.group).toHaveBeenCalledWith({
      kind: 'organization',
      organizationId: 'organization',
    })
    expect(mocks.organizationMembership).toHaveBeenCalledWith(
      principal,
      'organization',
      'member',
      'integrations.manage'
    )
    expect(mocks.catalog).toHaveBeenCalledWith(principal, expect.any(Object), 'managed_oauth')
  })

  it('connects a configured organization Slack app through its enrollment', async () => {
    mocks.catalog.mockResolvedValue([
      {
        type: 'oauth',
        available: true,
        name: 'Slack',
        authorizationOptions: [{ providerId: 'slack' }],
      },
    ])
    mocks.group.mockResolvedValue({
      ...group,
      options: [
        {
          id: 'slack-option',
          provider: 'slack',
          status: 'active',
          authorizationAppId: 'custom-app',
        },
      ],
    })
    expect(await execute({ providerId: 'slack' })).toEqual({
      providerId: 'slack',
      url: 'https://accounts.example.com/authorize?state=one-use',
    })
    expect(mocks.oauthContext).toHaveBeenCalledWith(expect.any(Object), 'slack-option')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('requires current workspace membership before enrollment lookup', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(execute()).rejects.toThrow()
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('does not let a reader add a provider to organization configuration', async () => {
    mocks.group.mockResolvedValue({ ...group, options: [] })
    await expect(execute()).rejects.toThrow('Ask an organization admin')
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('requires provider setup in organization settings even for a workspace admin', async () => {
    mocks.permission.mockResolvedValue('admin')
    mocks.group.mockResolvedValue({ ...group, options: [] })
    await expect(execute()).rejects.toThrow('Ask an organization admin')
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it.each([
    { ...group, status: 'disabled' },
    { ...group, options: [{ ...group.options[0], status: 'disabled' }] },
    { ...group, options: [group.options[0], group.options[0]] },
  ])('refuses disabled or ambiguous account configuration', async (configuration) => {
    mocks.group.mockResolvedValue(configuration)
    await expect(execute()).rejects.toThrow()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('does not authorize another person’s reconnect even for an admin', async () => {
    mocks.permission.mockResolvedValue('admin')
    await expect(execute({ credentialId: 'someone-else' })).rejects.toThrow('your own account')
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('reconnects an owned account only for the matching provider', async () => {
    mocks.personal.mockResolvedValue([{ id: 'mine', providerId: 'confluence' }])
    await execute({ credentialId: 'mine' })
    expect(mocks.personal).toHaveBeenCalledWith('workspace', 'viewer', 'mine')
    mocks.personal.mockResolvedValue([{ id: 'mine', providerId: 'gmail' }])
    await expect(execute({ credentialId: 'mine' })).rejects.toThrow('your own account')
  })

  it('honors provider visibility before minting an enrollment', async () => {
    mocks.catalog.mockResolvedValue([
      { type: 'oauth', available: false, authorizationOptions: [{ providerId: 'confluence' }] },
    ])
    await expect(execute()).rejects.toThrow('cannot be connected')
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('requires explicit Slack app setup rather than creating a bot or borrowing one', async () => {
    mocks.permission.mockResolvedValue('admin')
    mocks.catalog.mockResolvedValue([
      {
        type: 'oauth',
        available: true,
        name: 'Slack',
        authorizationOptions: [{ providerId: 'slack' }],
      },
    ])
    await expect(execute({ providerId: 'slack' })).rejects.toThrow(
      'enable Slack in organization settings'
    )
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('propagates revoked enrollment refusal', async () => {
    mocks.enroll.mockRejectedValue(new Error('Access revoked'))
    await expect(execute()).rejects.toThrow('Access revoked')
  })

  it('does not create a group when the organization has not configured accounts', async () => {
    mocks.group.mockResolvedValue(null)
    await expect(execute()).rejects.toThrow('set up Connected accounts in organization settings')
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('refuses personal workspaces before looking up organization accounts', async () => {
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    await expect(execute()).rejects.toThrow('does not belong to an organization')
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('requires organization membership even when the caller administers the workspace', async () => {
    mocks.permission.mockResolvedValue('admin')
    mocks.organizationMembership.mockRejectedValueOnce(new Error('Organization not found'))
    await expect(execute()).rejects.toThrow('Organization not found')
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('honors the organization feature flag before enrollment', async () => {
    mocks.available.mockResolvedValue(false)
    await expect(execute()).rejects.toThrow('not available')
    expect(mocks.available).toHaveBeenCalledWith({
      kind: 'organization',
      organizationId: 'organization',
    })
    expect(mocks.policy).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('connects the person’s own account without granting their workspace workflow access', async () => {
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('canonical-group', []),
    })
    await expect(execute()).resolves.toMatchObject({ providerId: 'confluence' })
    expect(mocks.enroll).toHaveBeenCalledWith({
      organizationId: 'organization',
      credentialGroupId: 'canonical-group',
      userId: 'viewer',
    })
  })

  it('propagates policy read failures without provisioning or enrollment', async () => {
    mocks.policy.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(execute()).rejects.toThrow('Database unavailable')
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before loading protected context', async () => {
    await expect(
      startPersonalCredentialConnection.execute({
        principal: { kind: 'workspace_api_key', keyId: 'key', workspaceId: 'workspace' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
})
