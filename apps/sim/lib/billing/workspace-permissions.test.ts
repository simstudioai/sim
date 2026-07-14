/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import {
  canManageWorkspaceBilling,
  getWorkspaceUsageLimitAction,
} from '@/lib/billing/workspace-permissions'

const HOST_CONTEXT: WorkspaceHostContext = {
  workspace: {
    id: 'workspace-b',
    name: 'Workspace B',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: 'org-b',
  ownerBilling: {
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
  },
  viewer: {
    permission: 'admin',
    isHostOrganizationMember: false,
    isHostOrganizationAdmin: false,
  },
}

describe('canManageWorkspaceBilling', () => {
  it('does not treat an external workspace admin as a host billing admin', () => {
    expect(canManageWorkspaceBilling(HOST_CONTEXT, 'external-a')).toBe(false)
  })

  it('allows a target-organization admin to manage host billing', () => {
    expect(
      canManageWorkspaceBilling(
        {
          ...HOST_CONTEXT,
          viewer: {
            ...HOST_CONTEXT.viewer,
            isHostOrganizationMember: true,
            isHostOrganizationAdmin: true,
          },
        },
        'admin-b'
      )
    ).toBe(true)
  })

  it('allows the billed user to manage a personal workspace', () => {
    expect(
      canManageWorkspaceBilling(
        {
          ...HOST_CONTEXT,
          workspace: {
            ...HOST_CONTEXT.workspace,
            workspaceMode: 'personal',
          },
          hostOrganizationId: null,
        },
        'owner-b'
      )
    ).toBe(true)
  })
})

describe('getWorkspaceUsageLimitAction', () => {
  it('offers host billing management only to target-organization admins', () => {
    const adminContext: WorkspaceHostContext = {
      ...HOST_CONTEXT,
      viewer: {
        ...HOST_CONTEXT.viewer,
        isHostOrganizationMember: true,
        isHostOrganizationAdmin: true,
      },
    }

    expect(
      getWorkspaceUsageLimitAction(adminContext, 'admin-b', {
        message: 'Organization usage limit exceeded.',
        scope: 'payer',
      })
    ).toEqual({ type: 'manage-billing', message: null })
  })

  it('gives an external workspace admin pooled copy without an upgrade action', () => {
    expect(
      getWorkspaceUsageLimitAction(HOST_CONTEXT, 'external-a', {
        message: 'Please upgrade your plan to continue.',
        scope: 'payer',
      })
    ).toEqual({
      type: 'notify',
      message:
        'This workspace’s pooled usage limit has been reached. Contact an organization administrator to increase it.',
    })
  })

  it('preserves member-cap copy and never turns it into a billing action', () => {
    expect(
      getWorkspaceUsageLimitAction(HOST_CONTEXT, 'external-a', {
        message: 'Your member credit limit has been reached.',
        scope: 'member',
      })
    ).toEqual({
      type: 'notify',
      message: 'Your member credit limit has been reached.',
    })
  })

  it('preserves actor-account blocks without offering payer management', () => {
    expect(
      getWorkspaceUsageLimitAction(HOST_CONTEXT, 'external-a', {
        message: 'Account frozen. Please contact support.',
        scope: 'actor',
      })
    ).toEqual({
      type: 'notify',
      message: 'Account frozen. Please contact support.',
    })
  })
})
