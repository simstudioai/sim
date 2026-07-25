/**
 * @vitest-environment node
 */
import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canOpenOrganizationSettingsSection,
  getOrganizationSettingsAccess,
} from '@/lib/organizations/settings-access'

afterAll(resetDbChainMock)

describe('organization settings access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([
    { role: 'owner', isAdmin: true },
    { role: 'admin', isAdmin: true },
    { role: 'member', isAdmin: false },
  ])('derives $role access from the route organization membership', async ({ role, isAdmin }) => {
    queueTableRows(member, [{ role }])

    await expect(getOrganizationSettingsAccess('organization-route', 'viewer')).resolves.toEqual({
      role,
      isMember: true,
      isAdmin,
    })
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: member.organizationId, right: 'organization-route' },
        { type: 'eq', left: member.userId, right: 'viewer' },
      ],
    })
  })

  it('rejects users without membership in the route organization', async () => {
    await expect(getOrganizationSettingsAccess('organization-route', 'viewer')).resolves.toEqual({
      role: null,
      isMember: false,
      isAdmin: false,
    })
  })

  it('allows members to view the roster but reserves control-plane sections for admins', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      canOpenOrganizationSettingsSection('organization-route', 'viewer', 'members')
    ).resolves.toBe(true)

    queueTableRows(member, [{ role: 'member' }])
    await expect(
      canOpenOrganizationSettingsSection('organization-route', 'viewer', 'sso')
    ).resolves.toBe(false)
  })
})
