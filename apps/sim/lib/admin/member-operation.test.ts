/**
 * @vitest-environment node
 */
import { member, organization, outboxEvent, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireOrganizationLock: vi.fn(),
  acquireUserLock: vi.fn(),
  ensureMembership: vi.fn(),
  transferMembership: vi.fn(),
  setMemberLimit: vi.fn(),
  reconcileSeats: vi.fn(),
  syncUsageLimits: vi.fn(),
  moveWorkspace: vi.fn(),
  recordAuditOnce: vi.fn(),
  enqueue: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    ORG_MEMBER_ADDED: 'organization.member_added',
    ORG_MEMBER_REMOVED: 'organization.member_removed',
  },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAuditOnce: mocks.recordAuditOnce,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.acquireOrganizationLock,
  ensureUserInOrganizationTx: mocks.ensureMembership,
  transferUserBetweenOrganizations: mocks.transferMembership,
}))
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mocks.acquireUserLock,
}))
vi.mock('@/lib/billing/organizations/member-limits', () => ({
  setOrgMemberUsageLimit: mocks.setMemberLimit,
}))
vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mocks.reconcileSeats,
}))
vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mocks.syncUsageLimits,
}))
vi.mock('@/lib/workspaces/admin-move', () => ({
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE: 'invitation.send-migrated-link',
  moveWorkspaceToOrganization: mocks.moveWorkspace,
}))
vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  ownedAttachableWorkspacesWhere: vi.fn(() => undefined),
}))
vi.mock('@/lib/core/outbox/service', () => ({
  continueOutboxHandler: (reason: string) => ({
    outcome: 'deferred',
    reason,
    consumeAttempt: false,
  }),
  deferOutboxHandler: (reason: string, _minimum?: number, consumeAttempt = true) => ({
    outcome: 'deferred',
    reason,
    ...(consumeAttempt ? {} : { consumeAttempt: false }),
  }),
  enqueueOutboxEvent: mocks.enqueue,
  outboxEventHasSourceOperationId: vi.fn(() => undefined),
  outboxPayloadHasSourceOperationId: vi.fn(
    (payload: { sourceOperationId?: string; sourceOperationIds?: string[] }, operationId: string) =>
      payload.sourceOperationId === operationId || payload.sourceOperationIds?.includes(operationId)
  ),
}))

import {
  getAdminMemberOperation,
  processAdminMemberOperation,
  startAdminMemberOperation,
} from '@/lib/admin/member-operation'

const actor = { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }

function payload(workspaceIds: string[]) {
  return {
    request: {
      organizationId: 'org-new',
      userId: 'user-1',
      role: 'member' as const,
      workspaceIds,
      sourceOrganizationId: 'org-old',
      actor,
    },
    progress: {
      memberId: null,
      transferredFromOrganizationId: null,
      nextWorkspaceIndex: 0,
      currentWorkspaceId: null,
    },
  }
}

afterAll(resetDbChainMock)

describe('durable admin member operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.reconcileSeats.mockResolvedValue(undefined)
    mocks.syncUsageLimits.mockResolvedValue(undefined)
    mocks.moveWorkspace.mockResolvedValue({})
    mocks.recordAuditOnce.mockResolvedValue(undefined)
  })

  it('recovers the same operation after membership committed but its response was lost', async () => {
    const existingPayload = payload(['workspace-1'])
    queueTableRows(outboxEvent, [
      {
        id: '1c38ca61-79d5-4d24-8094-c29cb52132ba',
        eventType: 'admin.organization-member-operation',
        payload: existingPayload,
        status: 'pending',
        attempts: 0,
        maxAttempts: 10,
        availableAt: new Date('2026-08-20T00:00:00.000Z'),
        lockedAt: null,
        lastError: null,
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        processedAt: null,
      },
    ])
    queueTableRows(organization, [{ id: 'org-new' }])
    queueTableRows(user, [
      {
        id: 'user-1',
        memberId: 'member-new',
        role: 'member',
        organizationId: 'org-new',
      },
    ])

    await expect(
      startAdminMemberOperation(
        '1c38ca61-79d5-4d24-8094-c29cb52132ba',
        'org-new',
        {
          userId: 'user-1',
          role: 'member',
          personalWorkspaceIds: ['workspace-1'],
        },
        actor
      )
    ).resolves.toMatchObject({
      status: 'pending',
      workspaceMoves: { selected: 1, moved: 0, pending: 1 },
    })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('infers committed membership, restores deterministic audits, and resumes workspace moves', async () => {
    queueTableRows(member, [{ id: 'member-new', role: 'member', organizationId: 'org-new' }])
    const checkpointPayload = vi.fn()

    await expect(
      processAdminMemberOperation(payload(['workspace-1', 'workspace-2']), {
        eventId: 'operation-1',
        eventType: 'admin.organization-member-operation',
        attempts: 1,
        checkpointPayload,
      })
    ).resolves.toBeUndefined()

    expect(mocks.recordAuditOnce).toHaveBeenCalledWith(
      'operation-1:member-added',
      expect.objectContaining({ resourceId: 'org-new' })
    )
    expect(mocks.moveWorkspace).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-1',
      destinationOrganizationId: 'org-new',
      adminEmail: 'admin@sim.ai',
      auditActor: { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' },
      auditOperationId: 'operation-1',
      expectedOwnerId: 'user-1',
      operationCorrelationId: 'operation-1',
    })
    expect(mocks.moveWorkspace).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-2',
      destinationOrganizationId: 'org-new',
      adminEmail: 'admin@sim.ai',
      auditActor: { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' },
      auditOperationId: 'operation-1',
      expectedOwnerId: 'user-1',
      operationCorrelationId: 'operation-1',
    })
    expect(checkpointPayload).toHaveBeenLastCalledWith({
      progress: {
        memberId: 'member-new',
        transferredFromOrganizationId: 'org-old',
        nextWorkspaceIndex: 2,
        currentWorkspaceId: null,
      },
    })
  })

  it('applies the requested role when a concurrent join wins the membership insert', async () => {
    const concurrentPayload = {
      ...payload([]),
      request: {
        ...payload([]).request,
        role: 'admin' as const,
        sourceOrganizationId: null,
      },
    }
    queueTableRows(member, [])
    queueTableRows(member, [{ role: 'member' }])
    mocks.ensureMembership.mockResolvedValue({
      success: true,
      memberId: 'member-new',
      alreadyMember: true,
    })
    const checkpointPayload = vi.fn()

    await expect(
      processAdminMemberOperation(concurrentPayload, {
        eventId: 'operation-1',
        eventType: 'admin.organization-member-operation',
        attempts: 0,
        checkpointPayload,
      })
    ).resolves.toBeUndefined()

    expect(dbChainMockFns.set).toHaveBeenCalledWith({ role: 'admin' })
    expect(checkpointPayload).toHaveBeenCalledWith({
      progress: {
        memberId: 'member-new',
        transferredFromOrganizationId: null,
        nextWorkspaceIndex: 0,
        currentWorkspaceId: null,
      },
    })
  })

  it('checkpoints a bounded workspace batch and defers without consuming an attempt', async () => {
    queueTableRows(member, [{ id: 'member-new', role: 'member', organizationId: 'org-new' }])
    const checkpointPayload = vi.fn()
    const workspaceIds = Array.from({ length: 12 }, (_, index) => `workspace-${index + 1}`)

    await expect(
      processAdminMemberOperation(payload(workspaceIds), {
        eventId: 'operation-1',
        eventType: 'admin.organization-member-operation',
        attempts: 0,
        checkpointPayload,
      })
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'Continuing bounded member workspace moves',
      consumeAttempt: false,
    })
    expect(mocks.moveWorkspace).toHaveBeenCalledTimes(10)
    expect(checkpointPayload).toHaveBeenLastCalledWith({
      progress: {
        memberId: 'member-new',
        transferredFromOrganizationId: 'org-old',
        nextWorkspaceIndex: 10,
        currentWorkspaceId: null,
      },
    })
  })

  it('checkpoints the active workspace before attempting its move', async () => {
    queueTableRows(member, [{ id: 'member-new', role: 'member', organizationId: 'org-new' }])
    mocks.moveWorkspace.mockRejectedValueOnce(new Error('Move failed'))
    const checkpointPayload = vi.fn()

    await expect(
      processAdminMemberOperation(payload(['workspace-1']), {
        eventId: 'operation-1',
        eventType: 'admin.organization-member-operation',
        attempts: 0,
        checkpointPayload,
      })
    ).rejects.toThrow('Move failed')

    expect(checkpointPayload).toHaveBeenLastCalledWith({
      progress: {
        memberId: 'member-new',
        transferredFromOrganizationId: 'org-old',
        nextWorkspaceIndex: 0,
        currentWorkspaceId: 'workspace-1',
      },
    })
  })

  it('does not mislabel a membership failure as a workspace failure', async () => {
    queueTableRows(outboxEvent, [
      {
        id: '1c38ca61-79d5-4d24-8094-c29cb52132ba',
        eventType: 'admin.organization-member-operation',
        payload: payload(['workspace-1', 'workspace-2']),
        status: 'dead_letter',
        lastError: 'Seat limit reached',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])
    queueTableRows(outboxEvent, [{ selected: 0, completed: 0, failed: 0 }])

    await expect(
      getAdminMemberOperation('org-new', '1c38ca61-79d5-4d24-8094-c29cb52132ba')
    ).resolves.toMatchObject({
      error: 'Seat limit reached',
      workspaceMoves: {
        selected: 2,
        moved: 0,
        pending: 2,
        failedCount: 0,
        failed: [],
      },
    })
  })

  it('separates the active failed workspace from still-pending workspaces', async () => {
    queueTableRows(outboxEvent, [
      {
        id: '1c38ca61-79d5-4d24-8094-c29cb52132ba',
        eventType: 'admin.organization-member-operation',
        payload: {
          ...payload(['workspace-1', 'workspace-2', 'workspace-3']),
          progress: {
            memberId: 'member-new',
            transferredFromOrganizationId: 'org-old',
            nextWorkspaceIndex: 1,
            currentWorkspaceId: 'workspace-2',
          },
        },
        status: 'dead_letter',
        lastError: 'Move failed',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])
    queueTableRows(outboxEvent, [{ selected: 0, completed: 0, failed: 0 }])

    await expect(
      getAdminMemberOperation('org-new', '1c38ca61-79d5-4d24-8094-c29cb52132ba')
    ).resolves.toMatchObject({
      workspaceMoves: {
        selected: 3,
        moved: 1,
        pending: 1,
        failedCount: 1,
        failed: [{ workspaceId: 'workspace-2', error: 'Move failed' }],
      },
    })
  })

  it('keeps migrated invitation delivery visible after the parent operation is applied', async () => {
    queueTableRows(outboxEvent, [
      {
        id: '1c38ca61-79d5-4d24-8094-c29cb52132ba',
        eventType: 'admin.organization-member-operation',
        payload: {
          ...payload(['workspace-1']),
          progress: {
            memberId: 'member-new',
            transferredFromOrganizationId: 'org-old',
            nextWorkspaceIndex: 1,
            currentWorkspaceId: null,
          },
        },
        status: 'completed',
        lastError: null,
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])
    queueTableRows(outboxEvent, [{ selected: 2, completed: 1, failed: 1 }])
    queueTableRows(outboxEvent, [
      {
        eventId: 'email-job-2',
        invitationId: 'invitation-2',
        error: 'provider unavailable',
      },
    ])

    await expect(
      getAdminMemberOperation('org-new', '1c38ca61-79d5-4d24-8094-c29cb52132ba')
    ).resolves.toMatchObject({
      status: 'applied',
      followUpJobs: {
        selected: 2,
        completed: 1,
        pending: 0,
        failedCount: 1,
        failed: [
          {
            eventId: 'email-job-2',
            kind: 'migrated_invitation_email',
            subjectId: 'invitation-2',
            error: 'provider unavailable',
          },
        ],
      },
    })
  })
})
