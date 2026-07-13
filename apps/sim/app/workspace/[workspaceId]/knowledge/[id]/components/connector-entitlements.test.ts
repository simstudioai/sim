/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
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

describe('hasWorkspaceMaxConnectorAccess', () => {
  it('uses the workspace host Max entitlement', () => {
    expect(hasWorkspaceMaxConnectorAccess(HOST_MAX_BILLING, true)).toBe(true)
  })

  it('does not unlock live sync from a free host plan', () => {
    expect(
      hasWorkspaceMaxConnectorAccess(
        {
          ...HOST_MAX_BILLING,
          plan: 'free',
          status: null,
          isPaid: false,
          isTeam: false,
          isOrgScoped: false,
          organizationId: null,
        },
        true
      )
    ).toBe(false)
  })

  it('does not unlock live sync for a blocked Max payer', () => {
    expect(
      hasWorkspaceMaxConnectorAccess(
        {
          ...HOST_MAX_BILLING,
          billingBlocked: true,
          billingBlockedReason: 'payment_failed',
        },
        true
      )
    ).toBe(false)
  })

  it('keeps connector intervals available when billing is disabled', () => {
    expect(
      hasWorkspaceMaxConnectorAccess(
        {
          ...HOST_MAX_BILLING,
          plan: 'free',
          status: null,
          isPaid: false,
        },
        false
      )
    ).toBe(true)
  })
})
