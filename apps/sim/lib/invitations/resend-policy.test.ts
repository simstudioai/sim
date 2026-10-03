import { db } from '@sim/db'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingIdentityLockMock,
  billingIdentityLockMockFns,
} from '@sim/testing/mocks/billing-identity-lock.mock'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import {
  permissionGroupLocksMock,
  permissionGroupLocksMockFns,
} from '@sim/testing/mocks/permission-group-locks.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => billingIdentityLockMock)
vi.mock('@/lib/permission-groups/locks', () => permissionGroupLocksMock)
vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

import type { InvitationWithGrants } from '@/lib/invitations/core'
import { lockInvitationResendPolicy } from '@/lib/invitations/resend-policy'

const mocks = {
  billingLock: billingIdentityLockMockFns.mockAcquireUserBillingIdentityLock,
  groupLock: permissionGroupLocksMockFns.mockAcquirePermissionGroupOrgLock,
  authority: invitationsCoreMockFns.mockRequireInvitationResendAuthority,
  admission: invitationsCoreMockFns.mockResolveInvitationAdmissionOrganizationId,
  workspacePolicy: workspacesPolicyMockFns.mockGetWorkspaceInvitePolicy,
  subscription: billingCoreMockFns.mockGetOrganizationSubscription,
}

const invitation: InvitationWithGrants = {
  id: 'invite',
  kind: 'organization',
  organizationId: 'org',
  membershipIntent: 'internal',
  email: 'person@example.com',
  inviterId: 'actor',
  role: 'member',
  status: 'pending',
  token: 'token',
  expiresAt: new Date('2099-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  organizationName: 'Organization',
  inviterName: 'Admin',
  inviterEmail: 'admin@example.com',
  grants: [
    { id: 'grant', workspaceId: 'workspace', permission: 'read', workspaceName: 'Workspace' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  setEnvFlags({ isBillingEnabled: true })
  permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
    id: 'workspace',
    organizationId: 'org',
    workspaceMode: 'personal',
    billedAccountUserId: 'billed-user',
  })
  mocks.admission.mockResolvedValue('org')
  mocks.workspacePolicy.mockResolvedValue({ allowed: true })
  mocks.subscription.mockResolvedValue({ status: 'active', plan: 'team' })
})
afterAll(resetEnvFlagsMock)

describe('locked resend policy', () => {
  it('locks parent contexts before authority rows and permission-group leaves, then reads policy on the same executor', async () => {
    await lockInvitationResendPolicy(db, invitation, 'actor', 'org')
    const order = [
      organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
      mocks.billingLock,
      mocks.authority,
      mocks.groupLock,
      permissionCheckMockFns.mockValidateInvitationsAllowed,
    ].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(mocks.authority).toHaveBeenCalledWith(db, invitation, 'actor', 'org')
    expect(mocks.admission).toHaveBeenCalledWith(invitation, db)
    expect(permissionCheckMockFns.mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'actor',
      { organizationId: 'org' },
      db
    )
    expect(permissionCheckMockFns.mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'actor',
      { workspaceId: 'workspace' },
      db
    )
    expect(mocks.workspacePolicy).toHaveBeenCalledWith(
      await permissionsMockFns.mockGetWorkspaceWithOwner.mock.results[0].value,
      db
    )
  })

  it('observes a restriction committed while waiting for the policy lock', async () => {
    const refusal = new Error('Invitations restricted')
    mocks.groupLock.mockImplementation(async () => {
      permissionCheckMockFns.mockValidateInvitationsAllowed.mockRejectedValue(refusal)
    })
    await expect(lockInvitationResendPolicy(db, invitation, 'actor')).rejects.toBe(refusal)
    expect(mocks.workspacePolicy).not.toHaveBeenCalled()
  })

  it('refuses a workspace whose paid invitation policy has lapsed', async () => {
    mocks.workspacePolicy.mockResolvedValue({
      allowed: false,
      upgradeRequired: true,
      reason: 'Plan required',
    })
    await expect(lockInvitationResendPolicy(db, invitation, 'actor')).rejects.toMatchObject({
      status: 403,
      upgradeRequired: true,
    })
  })

  it('rechecks grantless organization billing on the locked executor', async () => {
    mocks.subscription.mockResolvedValue(null)
    await expect(
      lockInvitationResendPolicy(db, { ...invitation, grants: [] }, 'actor')
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.subscription).toHaveBeenCalledWith('org', { executor: db, onError: 'throw' })
  })
})
