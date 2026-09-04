/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, outboxEvent, user, workspace } from '@sim/db/schema'
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAuditOnce: vi.fn(),
  assertInvitationEligibility: vi.fn(),
  getSeatRequirement: vi.fn(),
  getProvisioning: vi.fn(),
  issueProvisioning: vi.fn(),
  retryProvisioning: vi.fn(),
  acquireUserLock: vi.fn(),
  createOrganization: vi.fn(),
  enqueue: vi.fn(),
  patchPayload: vi.fn(),
  process: vi.fn(),
  sendEmail: vi.fn(),
  createDefaultWorkspace: vi.fn(),
  emitWorkspaceCreatedPlatformEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    ENTERPRISE_SUBSCRIPTION_PROVISIONED: 'subscription.enterprise_provisioned',
    ORGANIZATION_CREATED: 'organization.created',
    INVITATION_REVOKED: 'invitation.revoked',
  },
  AuditResourceType: { SUBSCRIPTION: 'subscription', ORGANIZATION: 'organization' },
  recordAuditOnce: mocks.recordAuditOnce,
}))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('@/components/emails', () => ({
  getEmailSubject: vi.fn(() => 'Enterprise owner invitation'),
  renderEnterpriseOwnerInvitationEmail: vi.fn(async () => '<p>Invite</p>'),
}))
vi.mock('@/lib/billing/enterprise-provisioning', () => {
  class EnterpriseProvisioningError extends Error {}
  return {
    EnterpriseProvisioningError,
    MAX_ENTERPRISE_WORKSPACE_SELECTION: 1_000,
    assertEnterpriseInvitationEligibility: mocks.assertInvitationEligibility,
    getEnterpriseIssuanceSeatRequirement: mocks.getSeatRequirement,
    getEnterpriseProvisioningById: mocks.getProvisioning,
    issueEnterpriseProvisioning: mocks.issueProvisioning,
    retryEnterpriseProvisioning: mocks.retryProvisioning,
  }
})
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mocks.acquireUserLock,
}))
vi.mock('@/lib/billing/organizations/create-organization', () => ({
  createOrganizationWithOwnerTx: mocks.createOrganization,
}))
vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mocks.enqueue,
  patchOutboxEventPayload: mocks.patchPayload,
  processOutboxEventById: mocks.process,
}))
vi.mock('@/lib/core/utils/urls', () => ({
  SITE_URL: 'https://sim.ai',
  getBaseUrl: vi.fn(() => 'https://sim.ai'),
}))
vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/workspaces/create', () => ({
  createDefaultPersonalWorkspaceInTransaction: mocks.createDefaultWorkspace,
  emitWorkspaceCreatedPlatformEvent: mocks.emitWorkspaceCreatedPlatformEvent,
}))
vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  ownedAttachableWorkspacesWhere: vi.fn(() => undefined),
}))

import {
  acceptEnterpriseOwnerClaim,
  enterpriseOwnerClaimOutboxHandlers,
  getEnterpriseOwnerClaimDetails,
  retryEnterpriseOwnerClaim,
  reviewEnterpriseOwnerClaim,
  revokeEnterpriseOwnerClaim,
} from '@/lib/billing/enterprise-owner-claim'

const now = new Date('2026-08-20T12:00:00.000Z')

const request = {
  requestKey: 'request-key',
  ownerEmail: 'owner@example.com',
  organizationName: 'Acme',
  requestedByEmail: 'admin@sim.ai',
  requestedByUserId: 'admin-1',
  requestedByName: 'Admin',
  invoiceAmountCents: 120_000,
  billingInterval: 'year' as const,
  invitations: [
    {
      email: 'teammate@example.com',
      role: 'member' as const,
      permission: 'write' as const,
    },
  ],
  usageLimitCredits: 240_000,
  seats: 2,
  pausePaymentCollection: false,
}

function claimPayload() {
  return {
    version: 1 as const,
    request,
    token: 'secure-token',
    expiresAt: '2026-08-27T12:00:00.000Z',
    delivery: { sentAt: '2026-08-20T12:00:00.000Z' },
  }
}

function claimRow(payload: Record<string, unknown> = claimPayload()) {
  return {
    id: 'claim-1',
    eventType: 'enterprise.invite-owner',
    payload,
    status: 'completed',
    attempts: 1,
    maxAttempts: 10,
    availableAt: now,
    lockedAt: null,
    lastError: null,
    createdAt: now,
    processedAt: now,
  }
}

afterAll(() => {
  vi.useRealTimers()
  resetDbChainMock()
})

describe('Enterprise future-owner claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.recordAuditOnce.mockResolvedValue(undefined)
    mocks.assertInvitationEligibility.mockResolvedValue(undefined)
    mocks.getSeatRequirement.mockResolvedValue({ requiredSeats: 2 })
    mocks.createOrganization.mockResolvedValue({ organizationId: 'org-1', memberId: 'member-1' })
    mocks.enqueue.mockResolvedValue('generated-id')
    mocks.patchPayload.mockResolvedValue(undefined)
    mocks.process.mockResolvedValue(undefined)
    mocks.getProvisioning.mockResolvedValue({
      status: 'applied',
      error: null,
      updatedAt: now.toISOString(),
    })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'owner-1' }])
  })

  it('rejects the future-owner path when an account already exists', async () => {
    queueTableRows(user, [{ id: 'existing-owner' }])

    await expect(
      reviewEnterpriseOwnerClaim({
        ownerEmail: 'OWNER@example.com',
        organizationName: 'Acme',
        invoiceAmountUsd: 1_200,
        invitations: [],
        seats: 1,
        requestedByEmail: 'admin@sim.ai',
        requestedByUserId: 'admin-1',
      })
    ).rejects.toThrow('A Sim account now exists')
    expect(mocks.assertInvitationEligibility).not.toHaveBeenCalled()
  })

  it('does not create anything when the disclosed workspace set changed', async () => {
    queueTableRows(outboxEvent, [claimRow()])
    queueTableRows(member, [])
    queueTableRows(workspace, [{ id: 'workspace-new' }])

    await expect(
      acceptEnterpriseOwnerClaim({
        claimId: 'claim-1',
        token: 'secure-token',
        userId: 'owner-1',
        userEmail: 'owner@example.com',
        userName: 'Owner',
        disclosedWorkspaceIds: ['workspace-old'],
        disclosedCreatesDefaultWorkspace: false,
      })
    ).resolves.toEqual({ success: false, kind: 'disclosure-outdated' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.createOrganization).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('surfaces canonical invitation workspace limits before the owner accepts', async () => {
    queueTableRows(outboxEvent, [claimRow()])
    queueTableRows(
      workspace,
      Array.from({ length: 51 }, (_, index) => ({
        id: `workspace-${index + 1}`,
        name: `Workspace ${index + 1}`,
        archivedAt: null,
      }))
    )
    queueTableRows(member, [])

    const details = await getEnterpriseOwnerClaimDetails({
      claimId: 'claim-1',
      token: 'secure-token',
      userId: 'owner-1',
      userEmail: 'owner@example.com',
    })
    expect(details).toMatchObject({
      acceptanceReview: {
        canAccept: false,
        requiredSeats: null,
        reason: expect.stringContaining('more than 50 workspaces'),
      },
    })
    expect(details?.workspacePreview?.workspacesToMove).toHaveLength(51)
    expect(mocks.getSeatRequirement).not.toHaveBeenCalled()
  })

  it('atomically creates ownership and enqueues activation after exact consent', async () => {
    queueTableRows(outboxEvent, [claimRow()])
    queueTableRows(member, [])
    queueTableRows(workspace, [{ id: 'workspace-1' }])
    mocks.process.mockImplementationOnce(async () => {
      const acceptance = mocks.patchPayload.mock.calls[0]?.[2]?.acceptance
      const acceptedPayload = { ...claimPayload(), acceptance }
      queueTableRows(outboxEvent, [claimRow(acceptedPayload)])
      queueTableRows(outboxEvent, [
        {
          ...claimRow({
            claimId: 'claim-1',
            provisioningOperationId: 'provisioning-1',
          }),
          id: 'generated-id',
          eventType: 'enterprise.activate-owner-claim',
        },
      ])
    })

    const result = await acceptEnterpriseOwnerClaim({
      claimId: 'claim-1',
      token: 'secure-token',
      userId: 'owner-1',
      userEmail: 'owner@example.com',
      userName: 'Owner',
      disclosedWorkspaceIds: ['workspace-1'],
      disclosedCreatesDefaultWorkspace: false,
    })

    expect(result).toMatchObject({
      success: true,
      claim: { organizationId: 'org-1', status: 'applied', stage: 'complete' },
    })
    expect(mocks.getSeatRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        workspaceIds: ['workspace-1'],
        existingSeatEmails: ['owner@example.com'],
      })
    )
    expect(mocks.createOrganization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerUserId: 'owner-1', name: 'Acme' })
    )
    expect(dbChainMockFns.update).toHaveBeenCalledWith(user)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      emailVerified: true,
      updatedAt: now,
    })
    expect(mocks.patchPayload).toHaveBeenCalledWith(
      expect.anything(),
      'claim-1',
      expect.objectContaining({
        acceptance: expect.objectContaining({
          organizationId: 'org-1',
          ownerUserId: 'owner-1',
          workspaceIds: ['workspace-1'],
          reportingPeriodAnchorDate: '2026-08-20',
        }),
      })
    )
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'enterprise.activate-owner-claim',
      { claimId: 'claim-1' },
      { id: 'generated-id' }
    )
  })

  it('rejects acceptance when the canonical account email no longer matches the claim', async () => {
    queueTableRows(outboxEvent, [claimRow()])
    queueTableRows(member, [])
    queueTableRows(workspace, [{ id: 'workspace-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      acceptEnterpriseOwnerClaim({
        claimId: 'claim-1',
        token: 'secure-token',
        userId: 'owner-1',
        userEmail: 'owner@example.com',
        userName: 'Owner',
        disclosedWorkspaceIds: ['workspace-1'],
        disclosedCreatesDefaultWorkspace: false,
      })
    ).resolves.toEqual({ success: false, kind: 'email-mismatch' })

    const updateConditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(
      updateConditions.some(
        (condition) =>
          condition.type === 'eq' && condition.left === user.id && condition.right === 'owner-1'
      )
    ).toBe(true)
    /** The folded address is one `eq`, not an OR over a dead column and an ad-hoc fold. */
    const emailConditions = updateConditions.filter(
      (condition) => condition?.type === 'eq' && condition.right === request.ownerEmail
    )
    expect(emailConditions).toHaveLength(1)
    expect(mocks.createOrganization).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('activates through the canonical Enterprise issuance operation only after acceptance', async () => {
    const accepted = {
      acceptedAt: '2026-08-20T12:00:00.000Z',
      ownerUserId: 'owner-1',
      organizationId: 'org-1',
      workspaceIds: ['workspace-1'],
      reportingPeriodAnchorDate: '2026-08-20',
      activationEventId: 'activation-1',
      createdDefaultWorkspaceId: null,
    }
    queueTableRows(outboxEvent, [claimRow({ ...claimPayload(), acceptance: accepted })])
    mocks.issueProvisioning.mockResolvedValue({ id: 'provisioning-1' })
    const checkpointPayload = vi.fn()

    await enterpriseOwnerClaimOutboxHandlers['enterprise.activate-owner-claim'](
      { claimId: 'claim-1' },
      {
        eventId: 'activation-1',
        eventType: 'enterprise.activate-owner-claim',
        attempts: 0,
        maxAttempts: 10,
        signal: new AbortController().signal,
        checkpointPayload,
      }
    )

    expect(mocks.issueProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'owner-1',
        organizationName: 'Acme',
        workspaceIds: ['workspace-1'],
        reportingPeriodAnchorDate: '2026-08-20',
        invitations: request.invitations,
      })
    )
    expect(checkpointPayload).toHaveBeenCalledWith({
      provisioningOperationId: 'provisioning-1',
    })
    expect(mocks.patchPayload).toHaveBeenCalledWith(db, 'claim-1', {
      provisioningOperationId: 'provisioning-1',
    })
  })

  it('revokes an unaccepted claim without starting activation', async () => {
    const revokedAt = now.toISOString()
    queueTableRows(outboxEvent, [claimRow()])
    queueTableRows(outboxEvent, [claimRow({ ...claimPayload(), revokedAt })])

    const result = await revokeEnterpriseOwnerClaim('claim-1', {
      id: 'admin-1',
      name: 'Admin',
      email: 'admin@sim.ai',
    })

    expect(result).toMatchObject({ id: 'claim-1', status: 'revoked' })
    expect(mocks.process).not.toHaveBeenCalled()
    expect(mocks.issueProvisioning).not.toHaveBeenCalled()
    expect(mocks.recordAuditOnce).toHaveBeenCalledWith(
      'claim-1:revoked',
      expect.objectContaining({
        action: 'invitation.revoked',
        resourceId: 'claim-1',
      })
    )
  })

  it('rejects acceptance after an invitation is revoked', async () => {
    queueTableRows(outboxEvent, [
      claimRow({ ...claimPayload(), revokedAt: '2026-08-20T11:00:00.000Z' }),
    ])

    await expect(
      acceptEnterpriseOwnerClaim({
        claimId: 'claim-1',
        token: 'secure-token',
        userId: 'owner-1',
        userEmail: 'owner@example.com',
        userName: 'Owner',
        disclosedWorkspaceIds: [],
        disclosedCreatesDefaultWorkspace: true,
      })
    ).resolves.toEqual({ success: false, kind: 'revoked' })
    expect(mocks.createOrganization).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('repairs the parent claim when activation already attached provisioning', async () => {
    const accepted = {
      acceptedAt: '2026-08-20T12:00:00.000Z',
      ownerUserId: 'owner-1',
      organizationId: 'org-1',
      workspaceIds: ['workspace-1'],
      reportingPeriodAnchorDate: '2026-08-20',
      activationEventId: 'activation-1',
      createdDefaultWorkspaceId: null,
    }
    const acceptedPayload = { ...claimPayload(), acceptance: accepted }
    const activationRow = {
      ...claimRow({ claimId: 'claim-1', provisioningOperationId: 'provisioning-1' }),
      id: 'activation-1',
      eventType: 'enterprise.activate-owner-claim',
    }
    queueTableRows(outboxEvent, [claimRow(acceptedPayload)])
    queueTableRows(outboxEvent, [activationRow])
    queueTableRows(outboxEvent, [
      claimRow({ ...acceptedPayload, provisioningOperationId: 'provisioning-1' }),
    ])
    queueTableRows(outboxEvent, [activationRow])

    const result = await retryEnterpriseOwnerClaim('claim-1')

    expect(result).toMatchObject({ status: 'applied', provisioningOperationId: 'provisioning-1' })
    expect(mocks.patchPayload).toHaveBeenCalledWith(expect.anything(), 'claim-1', {
      provisioningOperationId: 'provisioning-1',
    })
    expect(mocks.issueProvisioning).not.toHaveBeenCalled()
  })
})
