/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueMany: vi.fn(),
  recordAuditOnce: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { ORGANIZATION_UPDATED: 'organization.updated' },
  AuditResourceType: { ORGANIZATION: 'organization' },
  recordAuditOnce: mocks.recordAuditOnce,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))

vi.mock('@/lib/core/outbox/service', () => ({
  deferOutboxHandler: (reason: string, minimumBackoffMs?: number, consumeAttempt = true) => ({
    outcome: 'deferred',
    reason,
    ...(minimumBackoffMs === undefined ? {} : { minimumBackoffMs }),
    ...(consumeAttempt ? {} : { consumeAttempt: false }),
  }),
  enqueueOutboxEvent: mocks.enqueue,
  enqueueOutboxEvents: mocks.enqueueMany,
}))

import {
  ADMIN_INVITATION_OPERATION_EVENT_TYPE,
  adminInvitationOperationOutboxHandlers,
  createAdminInvitationOperation,
} from '@/lib/admin/invitation-operation'

describe('Admin invitation operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('atomically accepts one durable child per normalized recipient', async () => {
    const now = new Date('2026-08-20T00:00:00.000Z')
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.member, [{ id: 'owner-1' }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    queueTableRows(schemaMock.outboxEvent, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        eventType: ADMIN_INVITATION_OPERATION_EVENT_TYPE,
        status: 'pending',
        payload: {
          request: {
            organizationId: 'org-1',
            ownerUserId: 'owner-1',
            emails: ['a@example.com', 'b@example.com'],
            workspaceIds: ['workspace-1'],
            role: 'member',
            permission: 'write',
            actor: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
          },
        },
        attempts: 0,
        maxAttempts: 10,
        availableAt: now,
        lockedAt: null,
        lastError: null,
        createdAt: now,
        processedAt: null,
      },
    ])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [{ selected: 0, completed: 0, failed: 0 }])

    const operation = await createAdminInvitationOperation({
      operationId: '11111111-1111-4111-8111-111111111111',
      organizationId: 'org-1',
      emails: ['B@example.com', 'a@example.com'],
      workspaceIds: ['workspace-1'],
      role: 'member',
      permission: 'write',
      actor: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
    })

    expect(operation).toMatchObject({
      status: 'pending',
      invitations: { selected: 2, completed: 0, pending: 2, failedCount: 0 },
    })
    expect(mocks.enqueueMany).toHaveBeenCalledWith(expect.anything(), 'enterprise.invite-people', [
      expect.objectContaining({ email: 'a@example.com', source: 'admin', sequence: 0 }),
      expect.objectContaining({ email: 'b@example.com', source: 'admin', sequence: 1 }),
    ])
    expect(mocks.recordAuditOnce).not.toHaveBeenCalled()
  })

  it('waits for every recipient before the parent operation completes', async () => {
    queueTableRows(schemaMock.outboxEvent, [{ selected: 2, active: 1 }])

    await expect(
      adminInvitationOperationOutboxHandlers[ADMIN_INVITATION_OPERATION_EVENT_TYPE](
        {
          request: {
            organizationId: 'org-1',
            ownerUserId: 'owner-1',
            emails: ['a@example.com', 'b@example.com'],
            workspaceIds: ['workspace-1'],
            role: 'member',
            permission: 'write',
            actor: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
          },
        },
        {
          eventId: '11111111-1111-4111-8111-111111111111',
          eventType: ADMIN_INVITATION_OPERATION_EVENT_TYPE,
          attempts: 0,
          maxAttempts: 10,
          signal: new AbortController().signal,
          checkpointPayload: vi.fn(),
        }
      )
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'Waiting for invitation recipients',
      consumeAttempt: false,
    })
    expect(mocks.recordAuditOnce).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111:requested',
      expect.objectContaining({ resourceId: 'org-1' })
    )
  })
})
