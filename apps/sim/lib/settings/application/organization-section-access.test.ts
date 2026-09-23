/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canOpen: vi.fn(),
  enterprise: vi.fn(),
  governance: vi.fn(),
  groups: vi.fn(),
  search: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.groups,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mocks.search,
}))
vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: mocks.canOpen,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
  isOrganizationGovernanceActive: mocks.governance,
}))

import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'

describe('organization settings authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  /** Every other section keeps reading the plan gate, and pays no extra lookup for this one. */
  it('reads governance for no section but Access Control', async () => {
    await authorizeOrganizationSettingsSection({
      organizationId: 'target',
      userId: 'viewer',
      section: 'audit-logs',
    })

    expect(mocks.governance).not.toHaveBeenCalled()
    expect(mocks.enterprise).toHaveBeenCalledWith('target')
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

  it('keeps Credential Groups independent of Search availability', async () => {
    mocks.search.mockRejectedValue(new Error('Feature configuration unavailable'))
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'connected-accounts',
      })
    ).resolves.toBe(true)
    expect(mocks.search).not.toHaveBeenCalled()
  })

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

  it('does not require a plan or workspace for the member roster', async () => {
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'members',
      })
    ).toBe(true)
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  it('keeps request review independent of the Enterprise plan and Search rollout', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.governance.mockResolvedValue(false)
    mocks.search.mockResolvedValue(false)

    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'requests',
      })
    ).resolves.toBe(true)
    expect(mocks.canOpen).toHaveBeenCalledWith('target', 'admin', 'requests')
    expect(mocks.enterprise).not.toHaveBeenCalled()
    expect(mocks.governance).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
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
