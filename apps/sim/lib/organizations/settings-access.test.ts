/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnd, mockEq, mockLimit, mockWhere } = vi.hoisted(() => ({
  mockAnd: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockWhere.mockImplementation(() => ({ limit: mockLimit })),
      })),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    organizationId: 'member.organizationId',
    role: 'member.role',
    userId: 'member.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
}))

import {
  canOpenOrganizationSettingsSection,
  getOrganizationSettingsAccess,
} from '@/lib/organizations/settings-access'

describe('organization settings access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { role: 'owner', isAdmin: true },
    { role: 'admin', isAdmin: true },
    { role: 'member', isAdmin: false },
  ])('derives $role access from the route organization membership', async ({ role, isAdmin }) => {
    mockLimit.mockResolvedValueOnce([{ role }])

    await expect(getOrganizationSettingsAccess('organization-route', 'viewer')).resolves.toEqual({
      role,
      isMember: true,
      isAdmin,
    })
    expect(mockWhere).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'member.organizationId', right: 'organization-route' },
        { type: 'eq', left: 'member.userId', right: 'viewer' },
      ],
    })
  })

  it('rejects users without membership in the route organization', async () => {
    mockLimit.mockResolvedValueOnce([])

    await expect(getOrganizationSettingsAccess('organization-route', 'viewer')).resolves.toEqual({
      role: null,
      isMember: false,
      isAdmin: false,
    })
  })

  it('allows members to view the roster but reserves control-plane sections for admins', async () => {
    mockLimit.mockResolvedValueOnce([{ role: 'member' }])
    await expect(
      canOpenOrganizationSettingsSection('organization-route', 'viewer', 'members')
    ).resolves.toBe(true)

    mockLimit.mockResolvedValueOnce([{ role: 'member' }])
    await expect(
      canOpenOrganizationSettingsSection('organization-route', 'viewer', 'sso')
    ).resolves.toBe(false)
  })
})
