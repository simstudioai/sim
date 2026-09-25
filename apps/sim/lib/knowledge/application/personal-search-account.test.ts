import { user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  integrationsAvailabilityMock,
  integrationsAvailabilityMockFns,
} from '@sim/testing/mocks/integrations-availability.mock'
import { knowledgeAvailabilityMock } from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  accounts: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)
vi.mock('@/lib/credentials/organization-managed', () => ({
  getOwnOrganizationManagedOAuthCredentials: hoisted.accounts,
}))

import {
  authorizePersonalSearchSetup,
  authorizePersonalSearchSetupCredential,
} from '@/lib/knowledge/application/personal-search-account'

const mocks = {
  ...hoisted,
  approval: knowledgeSearchIntegrationPolicyMockFns.mockRequireOrganizationSearchApproval,
  deployed: integrationsAvailabilityMockFns.mockIsOAuthServiceDeploymentAvailable,
}

const principal = createSessionPrincipal({ userId: 'member-1' })
const input = {
  organizationId: 'organization-1',
  connectorType: 'jira',
  credentialId: 'own-account',
} as const

describe('personal Search setup authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetDbChainMock()
    queueTableRows(user, [{ emailVerified: true }])
    mocks.deployed.mockReturnValue(true)
    mocks.accounts.mockResolvedValue([
      {
        id: 'own-account',
        providerId: 'jira',
        displayName: 'Work account',
        scopes: ['read:jira-work'],
      },
    ])
  })

  it('permits a verified member and scopes the account lookup to that person and provider', async () => {
    await expect(authorizePersonalSearchSetupCredential(principal, input)).resolves.toMatchObject({
      id: 'own-account',
    })
    expect(organizationAuthorizationMockFns.mockRequireOrganizationMembership).toHaveBeenCalledWith(
      principal,
      input.organizationId,
      'member',
      'knowledge.use'
    )
    expect(mocks.approval).toHaveBeenCalledWith(input.organizationId, 'jira')
    expect(mocks.accounts).toHaveBeenCalledWith({
      organizationId: input.organizationId,
      userId: principal.userId,
      providerId: 'jira',
      credentialId: input.credentialId,
    })
  })

  it('rejects non-session callers before membership or protected account reads', async () => {
    await expect(
      authorizePersonalSearchSetup(createPersonalApiKeyPrincipal({ userId: 'member-1' }), input)
    ).rejects.toThrow('Sign in')
    expect(
      organizationAuthorizationMockFns.mockRequireOrganizationMembership
    ).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('rejects non-members before looking up credentials', async () => {
    organizationAuthorizationMockFns.mockRequireOrganizationMembership.mockRejectedValue(
      new Error('Membership ended')
    )
    await expect(authorizePersonalSearchSetupCredential(principal, input)).rejects.toThrow(
      'Membership ended'
    )
    expect(mocks.accounts).not.toHaveBeenCalled()
  })

  it('requires a verified email before approving or provisioning setup', async () => {
    resetDbChainMock()
    queueTableRows(user, [{ emailVerified: false }])
    await expect(authorizePersonalSearchSetup(principal, input)).rejects.toThrow(
      'Verify your email'
    )
    expect(mocks.approval).not.toHaveBeenCalled()
  })

  it.each([
    { accounts: [] },
    { accounts: [{ id: 'another-account', providerId: 'jira' }] },
    { accounts: [{ id: 'own-account', providerId: 'confluence' }] },
  ])('rejects revoked, foreign or mismatched grants %#', async ({ accounts }) => {
    mocks.accounts.mockResolvedValue(accounts)
    await expect(authorizePersonalSearchSetupCredential(principal, input)).rejects.toThrow(
      'Connect your account again'
    )
  })
})
