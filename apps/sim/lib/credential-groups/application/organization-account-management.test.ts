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
  credentialGroupsOrganizationSetupMock,
  credentialGroupsOrganizationSetupMockFns,
} from '@sim/testing/mocks/credential-groups-organization-setup.mock'
import { credentialGroupsSelfEnrollmentMock } from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import { credentialGroupsServiceMock } from '@sim/testing/mocks/credential-groups-service.mock'
import { knowledgeAvailabilityMock } from '@sim/testing/mocks/knowledge-availability.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)
vi.mock('@/lib/credential-groups/managed-mcp-service', () => ({
  ManagedMcpConnectorError: class extends Error {},
  createManagedMcpConnector: vi.fn(),
  deleteManagedMcpConnector: vi.fn(),
}))
vi.mock('@/lib/credential-groups/mcp-oauth-state', () => ({
  clearCredentialGroupMcpOAuthAttempts: vi.fn(),
}))
vi.mock('@/lib/mcp/connection-pool', () => ({ evictMcpServerConnections: vi.fn() }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  inviteOrganizationAccountPeople,
  listOrganizationAccountPeople,
  resendOrganizationAccountInvitation,
} from '@/lib/credential-groups/application/organization-account-management'

const mocks = {
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  group: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  setup: credentialGroupsOrganizationSetupMockFns.mockRequireOrganizationAccountsSetup,
  list: credentialGroupsEnrollmentsMockFns.mockListCredentialGroupEnrollments,
  invite: credentialGroupsEnrollmentsMockFns.mockInviteCredentialGroupEnrollments,
  resend: credentialGroupsEnrollmentsMockFns.mockResendCredentialGroupEnrollment,
  inviter: credentialGroupsEnrollmentsMockFns.mockLoadCredentialGroupInviterIdentity,
}
const authorize = organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation
const principal = createSessionPrincipal({ userId: 'admin-1' })
const input = { organizationId: 'org-1', limit: 50, cursor: 'cursor-1', search: 'example' }

describe('organization account people search application', () => {
  beforeEach(() => {
    authorize.mockResolvedValue({ organizationId: 'org-1', userId: 'admin-1', role: 'admin' })
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    mocks.setup.mockResolvedValue(undefined)
    mocks.inviter.mockResolvedValue({ name: 'Admin' })
    mocks.invite.mockResolvedValue({ results: [], sentCount: 0, failedCount: 0 })
    mocks.list.mockResolvedValue({ enrollments: [], nextCursor: null })
  })

  it('keeps canonical provider intent on connection requests and resends', async () => {
    mocks.group.mockResolvedValue({
      credentialGroupId: 'group-1',
      options: [{ id: 'gmail-option', provider: 'gmail', status: 'active' }],
    })
    await inviteOrganizationAccountPeople.execute({
      principal,
      input: { organizationId: 'org-1', emails: ['person@example.com'], optionId: 'gmail-option' },
    })
    expect(mocks.invite).toHaveBeenCalledWith(
      { kind: 'organization', organizationId: 'org-1' },
      'group-1',
      'admin-1',
      'Admin',
      { emails: ['person@example.com'] },
      { optionId: 'gmail-option', providerName: 'Gmail' }
    )
    await resendOrganizationAccountInvitation.execute({
      principal,
      input: { organizationId: 'org-1', enrollmentId: 'person', optionId: 'gmail-option' },
    })
    expect(mocks.resend).toHaveBeenCalledWith(
      { kind: 'organization', organizationId: 'org-1' },
      'group-1',
      'person',
      'admin-1',
      'Admin',
      { optionId: 'gmail-option', providerName: 'Gmail' }
    )
  })

  it('refuses a removed provider before requesting any account connection', async () => {
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1', options: [] })
    await expect(
      inviteOrganizationAccountPeople.execute({
        principal,
        input: { organizationId: 'org-1', emails: ['person@example.com'], optionId: 'removed' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it('does not query people or source accounts after current authorization is refused', async () => {
    authorize.mockRejectedValue(new OrchestrationError('forbidden', 'Admin access required'))
    await expect(listOrganizationAccountPeople.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'forbidden',
      }
    )
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('keeps feature availability and account-pool setup gates ahead of search', async () => {
    mocks.setup.mockRejectedValue(new OrchestrationError('conflict', 'Account setup required'))
    await expect(listOrganizationAccountPeople.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'conflict',
      }
    )
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
