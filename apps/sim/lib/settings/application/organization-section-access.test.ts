import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  canOpen: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: hoisted.canOpen,
}))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'

const mocks = {
  ...hoisted,
  groups: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  enterprise: billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan,
  governance: billingSubscriptionMockFns.mockIsOrganizationGovernanceActive,
  search: knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable,
}

describe('organization settings authorization', () => {
  beforeEach(() => {
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mocks.canOpen.mockResolvedValue(true)
    mocks.enterprise.mockResolvedValue(true)
    mocks.governance.mockResolvedValue(true)
    mocks.groups.mockResolvedValue(true)
    mocks.search.mockResolvedValue(true)
  })
  afterEach(resetEnvFlagsMock)

  it.each(['connected-accounts', 'search-mcp', 'search-slack', 'integrations'] as const)(
    'gates direct %s settings links using the target org',
    async (section) => {
      const gate = section === 'connected-accounts' ? mocks.groups : mocks.search
      gate.mockResolvedValue(false)
      await expect(
        authorizeOrganizationSettingsSection({
          organizationId: 'target',
          userId: 'viewer',
          section,
        })
      ).resolves.toBe(false)
      expect(gate).toHaveBeenCalledExactlyOnceWith(
        section === 'connected-accounts'
          ? { kind: 'organization', organizationId: 'target' }
          : { organizationId: 'target' }
      )
      expect(mocks.enterprise).not.toHaveBeenCalled()
    }
  )

  /**
   * Access Control configures restrictions that keep applying while a payment is failing, so the
   * page that edits them has to stay reachable — otherwise an organization is governed by rules
   * nobody can see or loosen until the invoice clears.
   */
  it('opens Access Control for an organization still being governed', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.governance.mockResolvedValue(true)

    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'access-control',
      })
    ).resolves.toBe(true)
  })

  it('closes Access Control once nothing governs the organization', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.governance.mockResolvedValue(false)

    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'access-control',
      })
    ).resolves.toBe(false)
  })

  it.each([
    { groups: false, search: false, connectedAccounts: false, integrations: false },
    { groups: true, search: false, connectedAccounts: true, integrations: false },
    { groups: true, search: true, connectedAccounts: true, integrations: true },
  ])(
    'selects the setup page with groups=$groups and search=$search',
    async ({ groups, search, connectedAccounts, integrations }) => {
      mocks.groups.mockResolvedValue(groups)
      mocks.search.mockResolvedValue(search)
      const input = { organizationId: 'target', userId: 'admin' }
      await expect(
        authorizeOrganizationSettingsSection({ ...input, section: 'connected-accounts' })
      ).resolves.toBe(connectedAccounts)
      await expect(
        authorizeOrganizationSettingsSection({ ...input, section: 'integrations' })
      ).resolves.toBe(integrations)
    }
  )

  it.each(['connected-accounts', 'integrations'] as const)(
    'checks role access before selecting the %s UI',
    async (section) => {
      mocks.canOpen.mockResolvedValue(false)
      await expect(
        authorizeOrganizationSettingsSection({
          organizationId: 'target',
          userId: 'member',
          section,
        })
      ).resolves.toBe(false)
      expect(mocks.groups).not.toHaveBeenCalled()
      expect(mocks.search).not.toHaveBeenCalled()
    }
  )

  it('checks current target organization membership before billing reads', async () => {
    mocks.canOpen.mockResolvedValue(false)
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'sso',
      })
    ).toBe(false)
    expect(mocks.canOpen).toHaveBeenCalledWith('target', 'viewer', 'sso')
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  it('rejects request review when target organization authority is absent', async () => {
    mocks.canOpen.mockResolvedValue(false)
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'member',
        section: 'requests',
      })
    ).resolves.toBe(false)
  })

  it('applies enterprise entitlement only after role authorization', async () => {
    mocks.enterprise.mockResolvedValue(false)
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'sso',
      })
    ).toBe(false)
  })

  it('does not turn authorization infrastructure failures into empty settings', async () => {
    mocks.canOpen.mockRejectedValue(new Error('Membership database unavailable'))
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'members',
      })
    ).rejects.toThrow('Membership database unavailable')
  })
})
