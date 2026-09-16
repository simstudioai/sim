/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

const { mockIsOrganizationOnEnterprisePlan, mockGetWorkspaceWithOwner } = vi.hoisted(() => ({
  mockIsOrganizationOnEnterprisePlan: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

import {
  getUserPermissionConfig,
  getUserPermissionConfigForOrganization,
  isOrganizationPermissionRegimeActive,
  resolveVerifiedUserAccessControlContext,
} from '@/lib/permission-groups/resolve.server'

const ORGANIZATION_ID = 'org-1'
const USER_ID = 'user-1'
const WORKSPACE_ID = 'workspace-1'

/**
 * Stands in for the entitlement resolver's two regimes: it answers `false` for
 * the lenient default — which is exactly what a swallowed billing outage looks
 * like — and rejects only for a caller that asked to throw. A resolution path
 * that drops the `'throw'` argument therefore reads the outage as "not
 * entitled" and these tests go red.
 */
function entitlementReadFails(): void {
  mockIsOrganizationOnEnterprisePlan.mockImplementation(
    async (_organizationId: string, onError?: string) => {
      if (onError === 'throw') throw new Error('billing database unavailable')
      return false
    }
  )
}

describe('permission-group resolution under a failed entitlement read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true, isAccessControlEnabled: true })
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: ORGANIZATION_ID })
  })

  afterAll(resetEnvFlagsMock)

  /**
   * `config: null` is not a stricter answer — it means every capability allowed
   * and every allowlist off. Resolving it from a billing-read failure would
   * turn the whole regime off for the request, so the failure has to surface.
   */
  it('rejects rather than resolving an unrestricted context for a verified workspace', async () => {
    entitlementReadFails()

    await expect(
      resolveVerifiedUserAccessControlContext(USER_ID, WORKSPACE_ID, ORGANIZATION_ID)
    ).rejects.toThrow('billing database unavailable')
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenCalledWith(ORGANIZATION_ID, 'throw')
  })

  it('rejects rather than resolving a null config from the workspace-lookup path', async () => {
    entitlementReadFails()

    await expect(getUserPermissionConfig(USER_ID, WORKSPACE_ID)).rejects.toThrow(
      'billing database unavailable'
    )
  })

  it('rejects rather than resolving a null config for the organization-addressed path', async () => {
    entitlementReadFails()

    await expect(getUserPermissionConfigForOrganization(ORGANIZATION_ID)).rejects.toThrow(
      'billing database unavailable'
    )
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenCalledWith(ORGANIZATION_ID, 'throw')
  })

  /**
   * The fail-closed policy must not turn a genuine plan lapse into an error:
   * an organization that simply is not on the plan still resolves to an
   * inactive context.
   */
  it('still resolves an inactive context when the organization is genuinely unentitled', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)

    await expect(
      resolveVerifiedUserAccessControlContext(USER_ID, WORKSPACE_ID, ORGANIZATION_ID)
    ).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      entitled: false,
      permissionGroup: null,
      config: null,
    })
    await expect(getUserPermissionConfigForOrganization(ORGANIZATION_ID)).resolves.toBeNull()
  })

  it('rechecks entitlement on the caller transaction after an unentitled preflight', async () => {
    const executor = {} as DbOrTx
    mockIsOrganizationOnEnterprisePlan.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(isOrganizationPermissionRegimeActive(ORGANIZATION_ID)).resolves.toBe(false)
    await expect(isOrganizationPermissionRegimeActive(ORGANIZATION_ID, executor)).resolves.toBe(
      true
    )
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenLastCalledWith(
      ORGANIZATION_ID,
      'throw',
      executor
    )
  })

  it('propagates a transaction entitlement read failure instead of disabling restrictions', async () => {
    const executor = {} as DbOrTx
    entitlementReadFails()

    await expect(isOrganizationPermissionRegimeActive(ORGANIZATION_ID, executor)).rejects.toThrow(
      'billing database unavailable'
    )
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      'throw',
      executor
    )
  })
})
