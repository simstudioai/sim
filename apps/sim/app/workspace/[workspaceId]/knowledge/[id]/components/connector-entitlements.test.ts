/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'
import { hasWorkspaceMaxConnectorAccess } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements'

const HOST_MAX_BILLING: WorkspaceOwnerBilling = {
  plan: 'team_25000',
  status: 'active',
  isPaid: true,
  isPro: false,
  isTeam: true,
  isEnterprise: false,
  isOrgScoped: true,
  organizationId: 'org-b',
  billingInterval: 'month',
  billingBlocked: false,
  billingBlockedReason: null,
}

const FREE_BILLING: WorkspaceOwnerBilling = {
  ...HOST_MAX_BILLING,
  plan: 'free',
  status: null,
  isPaid: false,
  isTeam: false,
  isOrgScoped: false,
  organizationId: null,
}

afterAll(resetEnvFlagsMock)

describe('hasWorkspaceMaxConnectorAccess', () => {
  beforeEach(() => {
    resetEnvFlagsMock()
    setEnvFlags({ isHosted: true, isBillingEnabled: true })
  })

  it('uses the workspace host Max entitlement', () => {
    expect(hasWorkspaceMaxConnectorAccess(HOST_MAX_BILLING)).toBe(true)
  })

  it('does not unlock live sync from a free host plan', () => {
    expect(hasWorkspaceMaxConnectorAccess(FREE_BILLING)).toBe(false)
  })

  it('does not unlock live sync for a blocked Max payer', () => {
    expect(
      hasWorkspaceMaxConnectorAccess({
        ...HOST_MAX_BILLING,
        billingBlocked: true,
        billingBlockedReason: 'payment_failed',
      })
    ).toBe(false)
  })

  it('keeps connector intervals available when billing is disabled', () => {
    setEnvFlags({ isBillingEnabled: false })

    expect(hasWorkspaceMaxConnectorAccess(FREE_BILLING)).toBe(true)
  })

  /**
   * The server gate is `!isHosted || !isBillingEnabled` — sub-hourly sync is
   * ungated off the hosted deployment. This client helper omitted the `isHosted`
   * branch, so a self-hosted operator with billing enabled saw "Live" locked while
   * the API would have accepted it.
   */
  it('keeps connector intervals available off the hosted deployment even with billing enabled', () => {
    setEnvFlags({ isHosted: false, isBillingEnabled: true })

    expect(hasWorkspaceMaxConnectorAccess(FREE_BILLING)).toBe(true)
  })
})
