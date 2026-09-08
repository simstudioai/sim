/**
 * @vitest-environment node
 */
import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAcquireOrganizationUserMutationLocks,
  mockApplySessionPolicyToNewMember,
  mockCaptureServerEvent,
  mockEnsureUserInOrganizationTx,
  mockReconcileOrganizationSeats,
  mockSyncUsageLimitsFromSubscription,
} = vi.hoisted(() => ({
  mockAcquireOrganizationUserMutationLocks: vi.fn(),
  mockApplySessionPolicyToNewMember: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockEnsureUserInOrganizationTx: vi.fn(),
  mockReconcileOrganizationSeats: vi.fn(),
  mockSyncUsageLimitsFromSubscription: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mockAcquireOrganizationUserMutationLocks,
  ensureUserInOrganizationTx: mockEnsureUserInOrganizationTx,
}))

vi.mock('@/lib/auth/session-policy', () => ({
  applySessionPolicyToNewMember: mockApplySessionPolicyToNewMember,
}))

vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mockReconcileOrganizationSeats,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mockSyncUsageLimitsFromSubscription,
}))

const { mockIsScimEntitledForOrganization } = vi.hoisted(() => ({
  mockIsScimEntitledForOrganization: vi.fn(),
}))
vi.mock('@/ee/scim/lib/entitlement', () => ({
  isScimEntitledForOrganization: mockIsScimEntitledForOrganization,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import { admitSsoUser } from '@/lib/auth/sso/application/admit-sso-user'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

function queueIdentity({
  organizationId = 'org-1',
  domain = 'example.com',
  domainVerified = true,
  jitProvisioningEnabled = true,
  accountLinked = true,
  email = 'person@example.com',
}: {
  organizationId?: string | null
  domain?: string
  domainVerified?: boolean
  jitProvisioningEnabled?: boolean
  accountLinked?: boolean
  email?: string
} = {}) {
  queueTableRows(schemaMock.ssoProvider, [
    {
      id: 'sso-1',
      domain,
      domainVerified,
      jitProvisioningEnabled,
      organizationId,
    },
  ])
  queueTableRows(schemaMock.user, [{ id: 'user-1', email, name: 'Person' }])
  queueTableRows(schemaMock.account, accountLinked ? [{ id: 'account-1' }] : [])
}

/** The directory-only read runs after the identity reads and before the membership lookup. */
function queueDirectoryOnly(directoryOnly: boolean) {
  queueTableRows(schemaMock.scimConnection, directoryOnly ? [{ id: 'scim-1' }] : [])
}

async function execute() {
  return admitSsoUser.execute({ principal, input: { providerId: 'acme-sso' } })
}

describe('SSO JIT admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnsureUserInOrganizationTx.mockResolvedValue({
      success: true,
      memberId: 'member-1',
      alreadyMember: false,
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    })
  })

  it('adds a verified linked identity as a seat-enforced member', async () => {
    queueIdentity()

    await expect(execute()).resolves.toEqual({
      kind: 'provisioned',
      organizationId: 'org-1',
      memberId: 'member-1',
    })
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledWith(dbChainMock.db, {
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'member',
    })
    expect(mockApplySessionPolicyToNewMember).toHaveBeenCalledWith('user-1', 'org-1')
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-1',
      reason: 'sso-jit-member-added',
      actorId: 'user-1',
    })
    expect(mockSyncUsageLimitsFromSubscription).toHaveBeenCalledWith('user-1')
    expect(auditMock.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        resourceId: 'org-1',
        metadata: expect.objectContaining({ source: 'sso_jit' }),
      })
    )
  })

  it('fails closed when the callback provider no longer exists', async () => {
    await expect(execute()).resolves.toEqual({
      kind: 'denied',
      reason: 'provider-not-found',
    })
    expect(mockAcquireOrganizationUserMutationLocks).not.toHaveBeenCalled()
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('fails closed when the callback provider is not domain-trusted', async () => {
    queueIdentity({ domainVerified: false })

    await expect(execute()).resolves.toEqual({
      kind: 'denied',
      reason: 'provider-not-trusted',
    })
    expect(mockAcquireOrganizationUserMutationLocks).not.toHaveBeenCalled()
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('is idempotent for an existing member', async () => {
    queueIdentity()
    queueTableRows(schemaMock.member, [{ id: 'member-existing', organizationId: 'org-1' }])

    await expect(execute()).resolves.toEqual({
      kind: 'already-member',
      organizationId: 'org-1',
      memberId: 'member-existing',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('authenticates without membership when provisioning is invite-only', async () => {
    queueIdentity({ jitProvisioningEnabled: false })

    await expect(execute()).resolves.toEqual({
      kind: 'provisioning-disabled',
      organizationId: 'org-1',
    })
    expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledWith(dbChainMock.db, {
      userId: 'user-1',
      organizationIds: ['org-1'],
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('leaves admission to the directory when a connection has disabled JIT', async () => {
    queueIdentity()
    queueDirectoryOnly(true)
    mockIsScimEntitledForOrganization.mockResolvedValue(true)

    await expect(execute()).resolves.toEqual({
      kind: 'provisioning-disabled',
      organizationId: 'org-1',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('admits by JIT again once the directory can no longer sync', async () => {
    queueIdentity()
    queueDirectoryOnly(true)
    mockIsScimEntitledForOrganization.mockResolvedValue(false)

    const outcome = await execute()

    expect(outcome.kind).toBe('provisioned')
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalled()
  })

  it('keeps an existing member active when new provisioning is invite-only', async () => {
    queueIdentity({ jitProvisioningEnabled: false })
    queueTableRows(schemaMock.member, [{ id: 'member-existing' }])

    await expect(execute()).resolves.toEqual({
      kind: 'already-member',
      organizationId: 'org-1',
      memberId: 'member-existing',
    })
    expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledWith(dbChainMock.db, {
      userId: 'user-1',
      organizationIds: ['org-1'],
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('leaves an organization-less self-hosted provider outside JIT', async () => {
    queueIdentity({ organizationId: null })

    await expect(execute()).resolves.toEqual({
      kind: 'organization-not-bound',
      organizationId: null,
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('preserves a pending invitation instead of erasing its role and grants', async () => {
    queueIdentity()
    queueTableRows(schemaMock.invitation, [{ id: 'invite-1' }])

    await expect(execute()).resolves.toEqual({
      kind: 'pending-invitation',
      organizationId: 'org-1',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('preserves existing external workspace access without consuming a seat', async () => {
    queueIdentity()
    queueTableRows(schemaMock.permissions, [{ id: 'permission-1' }])

    await expect(execute()).resolves.toEqual({
      kind: 'external-collaborator',
      organizationId: 'org-1',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('only preserves external access from active workspaces', async () => {
    queueIdentity()

    await expect(execute()).resolves.toEqual({
      kind: 'provisioned',
      organizationId: 'org-1',
      memberId: 'member-1',
    })
    const conditions = dbChainMockFns.where.mock.calls.flatMap(([condition]) =>
      flattenMockConditions(condition)
    )
    expect(conditions).toContainEqual({ type: 'isNull', column: schemaMock.workspace.archivedAt })
  })

  it('rejects a user who belongs to another organization', async () => {
    queueIdentity()
    queueTableRows(schemaMock.member, [{ id: 'member-other', organizationId: 'org-other' }])

    await expect(execute()).resolves.toEqual({
      kind: 'denied',
      reason: 'organization-conflict',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('returns an actionable denial without creating membership when no seat is available', async () => {
    queueIdentity()
    mockEnsureUserInOrganizationTx.mockResolvedValue({
      success: false,
      alreadyMember: false,
      failureCode: 'no-seats-available',
      error: 'No seats',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    })

    await expect(execute()).resolves.toEqual({
      kind: 'denied',
      reason: 'seats-unavailable',
    })
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('uses elastic Team seats and reconciles the billed count after admission', async () => {
    queueIdentity()
    queueTableRows(schemaMock.subscription, [{ id: 'subscription-current', plan: 'team' }])

    await expect(execute()).resolves.toEqual({
      kind: 'provisioned',
      organizationId: 'org-1',
      memberId: 'member-1',
    })
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledWith(dbChainMock.db, {
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'member',
      skipSeatValidation: true,
      organizationSubscriptionId: 'subscription-current',
    })
    expect(mockReconcileOrganizationSeats).toHaveBeenCalledWith({
      organizationId: 'org-1',
      reason: 'sso-jit-member-added',
      actorId: 'user-1',
      subscriptionId: 'subscription-current',
    })
  })

  it('pins fixed Enterprise capacity checks to the subscription used for plan classification', async () => {
    queueIdentity()
    queueTableRows(schemaMock.subscription, [{ id: 'subscription-current', plan: 'enterprise' }])

    await expect(execute()).resolves.toEqual({
      kind: 'provisioned',
      organizationId: 'org-1',
      memberId: 'member-1',
    })
    expect(mockEnsureUserInOrganizationTx).toHaveBeenCalledWith(dbChainMock.db, {
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'member',
      organizationSubscriptionId: 'subscription-current',
    })
  })

  it('fails closed when the callback identity is not linked to the provider', async () => {
    queueIdentity({ accountLinked: false })

    await expect(execute()).resolves.toEqual({
      kind: 'denied',
      reason: 'account-not-linked',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('fails closed when the asserted email is outside the verified provider domain', async () => {
    queueIdentity({ email: 'person@other.example' })

    await expect(execute()).resolves.toEqual({
      kind: 'denied',
      reason: 'domain-mismatch',
    })
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })

  it('rejects a principal kind the callback adapter cannot construct before reading identity', async () => {
    await expect(
      admitSsoUser.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'key-1',
        },
        input: { providerId: 'acme-sso' },
      })
    ).rejects.toThrow('Operation sso.jit-admit reached by principal kind workspace_api_key')
    expect(mockAcquireOrganizationUserMutationLocks).not.toHaveBeenCalled()
    expect(mockEnsureUserInOrganizationTx).not.toHaveBeenCalled()
  })
})
