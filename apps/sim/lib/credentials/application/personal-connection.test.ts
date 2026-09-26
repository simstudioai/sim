import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import {
  credentialGroupsSelfEnrollmentMock,
  credentialGroupsSelfEnrollmentMockFns,
} from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import {
  credentialGroupsServiceMock,
  credentialGroupsServiceMockFns,
} from '@sim/testing/mocks/credential-groups-service.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  catalog: vi.fn(),
  personal: vi.fn(),
  startOAuth: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: hoisted.catalog,
}))
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)
vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: hoisted.startOAuth }))
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/credentials/personal', () => ({ getPersonalOAuthCredentials: hoisted.personal }))

import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { startPersonalCredentialConnection } from '@/lib/credentials/application/personal-connection'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')

const mocks = {
  ...hoisted,
  policy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  group: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  ensure: credentialGroupsServiceMockFns.mockEnsureWorkspaceAccountsGroup,
  enroll: credentialGroupsSelfEnrollmentMockFns.mockCreateViewerCredentialGroupEnrollment,
  oauthContext: credentialGroupsEnrollmentsMockFns.mockGetCredentialGroupOAuthContextForEnrollment,
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  workspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  organizationMembership: organizationAuthorizationMockFns.mockRequireOrganizationMembership,
}

const principal = createSessionPrincipal({ userId: 'viewer', sessionId: 'session' })
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
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: 'organization',
      allowPersonalApiKeys: true,
    })
    mocks.permission.mockResolvedValue('read')
    mocks.organizationMembership.mockResolvedValue({ userId: 'viewer', role: 'member' })
    mocks.available.mockResolvedValue(true)
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy(
        'canonical-group',
        ['workspace'].map((workspaceId) => ({ workspaceId, access: { mode: 'all' as const } }))
      ),
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
    expect(mocks.enroll).toHaveBeenCalledWith({
      userId: 'viewer',
      organizationId: 'organization',
      credentialGroupId: 'canonical-group',
    })
    expect(mocks.ensure).not.toHaveBeenCalled()
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
})
