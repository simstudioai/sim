/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canOpen: vi.fn(),
  enterprise: vi.fn(),
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
}))

import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'

describe('organization settings authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
    mocks.canOpen.mockResolvedValue(true)
    mocks.enterprise.mockResolvedValue(true)
    mocks.groups.mockResolvedValue(true)
    mocks.search.mockResolvedValue(true)
  })
  afterEach(resetEnvFlagsMock)

  it.each(['connected-accounts', 'search-mcp', 'integrations'] as const)(
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

  it.each([
    { groups: false, search: false, connectedAccounts: false, integrations: false },
    { groups: true, search: false, connectedAccounts: true, integrations: false },
    { groups: true, search: true, connectedAccounts: false, integrations: true },
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

  it('propagates Search availability failures instead of selecting the old UI', async () => {
    mocks.search.mockRejectedValue(new Error('Feature configuration unavailable'))
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'connected-accounts',
      })
    ).rejects.toThrow('Feature configuration unavailable')
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
