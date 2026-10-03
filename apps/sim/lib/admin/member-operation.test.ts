import { member, organization, outboxEvent, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingIdentityLockMock } from '@sim/testing/mocks/billing-identity-lock.mock'
import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import { organizationMemberLimitsMock } from '@sim/testing/mocks/organization-member-limits.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  organizationSeatsMock,
  organizationSeatsMockFns,
} from '@sim/testing/mocks/organization-seats.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  moveWorkspace: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => billingIdentityLockMock)
vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)
vi.mock('@/lib/billing/core/usage', () => billingUsageMock)
vi.mock('@/lib/workspaces/admin-move', () => ({
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE: 'invitation.send-migrated-link',
  moveWorkspaceToOrganization: hoisted.moveWorkspace,
}))
vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  ownedAttachableWorkspacesWhere: vi.fn(() => undefined),
}))
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

import {
  processAdminMemberOperation,
  startAdminMemberOperation,
} from '@/lib/admin/member-operation'

const mocks = {
  ...hoisted,
  reconcileSeats: organizationSeatsMockFns.mockReconcileOrganizationSeats,
  syncUsageLimits: billingUsageMockFns.mockSyncUsageLimitsFromSubscription,
  enqueue: outboxServiceMockFns.mockEnqueueOutboxEvent,
  acquireOrganizationLock: organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
  ensureMembership: organizationMembershipMockFns.mockEnsureUserInOrganizationTx,
  transferMembership: organizationMembershipMockFns.mockTransferUserBetweenOrganizations,
  recordAuditOnce: auditMockFns.mockRecordAuditOnce,
}

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
})
