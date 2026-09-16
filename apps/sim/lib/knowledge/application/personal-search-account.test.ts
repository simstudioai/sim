/** @vitest-environment node */
import { user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  membership: vi.fn(),
  approval: vi.fn(),
  available: vi.fn(),
  deployed: vi.fn(),
  accounts: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  requireOrganizationMembership: mocks.membership,
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  requireOrganizationSearchApproval: mocks.approval,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireKnowledgeMemberAccessAvailable: mocks.available,
}))
vi.mock('@/lib/integrations/availability.server', () => ({
  isOAuthServiceDeploymentAvailable: mocks.deployed,
}))
vi.mock('@/lib/credentials/organization-managed', () => ({
  getOwnOrganizationManagedOAuthCredentials: mocks.accounts,
}))

import {
  authorizePersonalSearchSetup,
  authorizePersonalSearchSetupCredential,
} from '@/lib/knowledge/application/personal-search-account'

const principal = { kind: 'session', userId: 'member-1', sessionId: 'session-1' } as const
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
    expect(mocks.membership).toHaveBeenCalledWith(
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
      authorizePersonalSearchSetup(
        { kind: 'personal_api_key', userId: 'member-1', keyId: 'key-1' },
        input
      )
    ).rejects.toThrow('Sign in')
    expect(mocks.membership).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('rejects non-members before looking up credentials', async () => {
    mocks.membership.mockRejectedValue(new Error('Membership ended'))
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

  it.each(['approval', 'available'] as const)(
    'propagates the %s refusal before account discovery',
    async (gate) => {
      mocks[gate].mockRejectedValue(new Error('Source disabled'))
      await expect(authorizePersonalSearchSetupCredential(principal, input)).rejects.toThrow(
        'Source disabled'
      )
      expect(mocks.accounts).not.toHaveBeenCalled()
    }
  )

  it('rejects an unavailable OAuth deployment', async () => {
    mocks.deployed.mockReturnValue(false)
    await expect(authorizePersonalSearchSetupCredential(principal, input)).rejects.toThrow(
      'unavailable'
    )
    expect(mocks.accounts).not.toHaveBeenCalled()
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
