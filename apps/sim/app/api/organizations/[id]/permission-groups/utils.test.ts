/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsOrganizationAdminOrOwner, mockIsOrganizationOnEnterprisePlan } = vi.hoisted(() => ({
  mockIsOrganizationAdminOrOwner: vi.fn<() => Promise<boolean>>(),
  mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  isOrganizationAdminOrOwner: mockIsOrganizationAdminOrOwner,
}))

import { authorizeOrgAccessControl } from './utils'

describe('authorizeOrgAccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a 403 when the user is not an organization admin/owner', async () => {
    mockIsOrganizationAdminOrOwner.mockResolvedValue(false)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)

    const response = await authorizeOrgAccessControl('user-1', 'org-1')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: 'Admin permissions required' })
    // Entitlement is only checked after the admin gate passes.
    expect(mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('returns a 403 when the organization is not on an enterprise plan', async () => {
    mockIsOrganizationAdminOrOwner.mockResolvedValue(true)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)

    const response = await authorizeOrgAccessControl('user-1', 'org-1')

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: 'Access Control is an Enterprise feature',
    })
  })

  it('returns null when the user is an admin and the org is entitled', async () => {
    mockIsOrganizationAdminOrOwner.mockResolvedValue(true)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)

    const response = await authorizeOrgAccessControl('user-1', 'org-1')

    expect(response).toBeNull()
  })
})
