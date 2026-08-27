/** @vitest-environment node */

import {
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  outboxEvent,
  subscription,
  workspace,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import {
  buildPendingInvitationMergeScopeCondition,
  classifyWorkspaceMoveState,
  getWorkspaceMoveOperation,
  getWorkspaceMovePreflight,
  invitationMigrationOutboxHandlers,
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE,
  moveWorkspaceToOrganization,
  projectDestinationPendingSeatCount,
} from '@/lib/workspaces/admin-move'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

vi.unmock('drizzle-orm')

const {
  recordAudit,
  recordAuditOnce,
  enqueueOrReschedulePendingOutboxEvent,
  invalidateWorkspaceTableLimitsCache,
  changeWorkspaceStoragePayerInTx,
  acquireInvitationMutationLocks,
  getInvitationById,
  isInvitationExpired,
  sendInvitationEmail,
  countPendingSeatInvitations,
  resolveSeatCapacity,
} = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  recordAuditOnce: vi.fn(),
  enqueueOrReschedulePendingOutboxEvent: vi.fn(),
  invalidateWorkspaceTableLimitsCache: vi.fn(),
  changeWorkspaceStoragePayerInTx: vi.fn(),
  acquireInvitationMutationLocks: vi.fn(),
  getInvitationById: vi.fn(),
  isInvitationExpired: vi.fn(() => false),
  sendInvitationEmail: vi.fn(),
  countPendingSeatInvitations: vi.fn(() => Promise.resolve(0)),
  resolveSeatCapacity: vi.fn(() => Promise.resolve(10)),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKSPACE_UPDATED: 'workspace.updated', INVITATION_UPDATED: 'invitation.updated' },
  AuditResourceType: { WORKSPACE: 'workspace' },
  recordAudit,
  recordAuditOnce,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))
vi.mock('@/lib/billing/storage/payer-transfer', () => ({ changeWorkspaceStoragePayerInTx }))
vi.mock('@/lib/billing/validation/seat-management', () => ({
  countPendingSeatInvitations,
  planHasFixedSeatCap: vi.fn((plan: string) => plan === 'enterprise'),
  resolveSeatCapacity,
}))
vi.mock('@/lib/core/outbox/service', () => ({
  addOutboxEventSourceOperationId: vi.fn(),
  enqueueOrReschedulePendingOutboxEvent,
  outboxEventHasSourceOperationId: vi.fn(() => undefined),
  outboxPayloadHasSourceOperationId: vi.fn(
    (payload: { sourceOperationId?: string; sourceOperationIds?: string[] }, operationId: string) =>
      payload.sourceOperationId === operationId || payload.sourceOperationIds?.includes(operationId)
  ),
}))
vi.mock('@/lib/invitations/core', () => ({
  getInvitationById,
  isInvitationExpired,
}))
vi.mock('@/lib/invitations/locks', () => ({ acquireInvitationMutationLocks }))
vi.mock('@/lib/invitations/send', () => ({
  PENDING_INVITATION_UNIQUE_INDEX: 'invitation_pending_email_org_unique',
  sendInvitationEmail,
}))
vi.mock('@/lib/table/billing', () => ({ invalidateWorkspaceTableLimitsCache }))

const movedWorkspace = {
  id: 'workspace-1',
  name: 'Already moved',
  ownerId: 'workspace-owner',
  ownerName: 'Workspace Owner',
  ownerEmail: 'workspace-owner@example.com',
  workspaceMode: WORKSPACE_MODE.ORGANIZATION,
  organizationId: 'org-1',
  billedAccountUserId: 'org-owner',
  archivedAt: null,
}

const personalWorkspace = {
  ...movedWorkspace,
  name: 'Personal workspace',
  workspaceMode: WORKSPACE_MODE.PERSONAL,
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  storageUsedBytes: 128,
}

const destination = {
  id: 'org-1',
  name: 'Destination',
  ownerId: 'org-owner',
  ownerName: 'Organization Owner',
  ownerEmail: 'org-owner@example.com',
}

/**
 * The move flow reads the workspace twice in order — the locked classification
 * row and the final summary reload — so the workspace queue gets one set per
 * read. All invitation/grant/permission selects resolve the queue-less empty
 * default.
 */
function queueMoveSelects(workspaceRow: Record<string, unknown>) {
  queueTableRows(workspace, [workspaceRow])
  queueTableRows(workspace, [workspaceRow])
  queueTableRows(organization, [destination])
}

afterAll(resetDbChainMock)

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  changeWorkspaceStoragePayerInTx.mockResolvedValue({
    billableBytes: 128,
    newPayer: { type: 'organization', id: destination.id },
    oldPayer: { type: 'user', id: personalWorkspace.billedAccountUserId },
    repairedWorkspaceLedger: false,
  })
})

describe('classifyWorkspaceMoveState', () => {
  it('treats the exact destination postcondition as an idempotent success', () => {
    expect(
      classifyWorkspaceMoveState(
        {
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId: 'org-1',
          archivedAt: new Date(),
        },
        'org-1'
      )
    ).toBe('already-moved')
  })

  it('continues to reject inter-organization transfers', () => {
    expect(() =>
      classifyWorkspaceMoveState(
        {
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId: 'org-1',
          archivedAt: null,
        },
        'org-2'
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkspaceMoveError>>({
        code: 'already-organization-workspace',
      })
    )
  })

  it('rejects a drifted non-organization mode when an organization is still assigned', () => {
    expect(() =>
      classifyWorkspaceMoveState(
        {
          workspaceMode: WORKSPACE_MODE.PERSONAL,
          organizationId: 'org-source',
          archivedAt: null,
        },
        'org-destination'
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkspaceMoveError>>({
        code: 'already-organization-workspace',
      })
    )
  })

  it('keeps archived personal workspaces movable so they cannot dodge organization purview', () => {
    expect(
      classifyWorkspaceMoveState(
        { workspaceMode: WORKSPACE_MODE.PERSONAL, organizationId: null, archivedAt: new Date() },
        'org-1'
      )
    ).toBe('move')
  })
})

describe('workspace move invitation bounds', () => {
  it('blocks a move preflight instead of truncating an oversized pending invitation set', async () => {
    queueTableRows(workspace, [personalWorkspace])
    queueTableRows(organization, [destination])
    queueTableRows(
      invitationWorkspaceGrant,
      Array.from({ length: 1_001 }, (_, index) => ({
        id: `invitation-${index}`,
        email: `invitee-${index}@example.com`,
        organizationId: null,
        membershipIntent: 'internal',
        permission: 'read',
      }))
    )

    await expect(getWorkspaceMovePreflight('workspace-1', 'org-1')).rejects.toMatchObject({
      code: 'invitation-volume-exceeded',
      message: expect.stringContaining('none were migrated'),
    })
  })

  it('blocks a move when bounded invitation rows expand into too many workspace grants', async () => {
    queueTableRows(workspace, [personalWorkspace])
    queueTableRows(organization, [destination])
    queueTableRows(invitationWorkspaceGrant, [
      {
        id: 'invitation-1',
        email: 'one@example.com',
        organizationId: null,
        membershipIntent: 'internal',
        permission: 'read',
      },
      {
        id: 'invitation-2',
        email: 'two@example.com',
        organizationId: null,
        membershipIntent: 'internal',
        permission: 'read',
      },
    ])
    queueTableRows(invitationWorkspaceGrant, [
      { invitationId: 'invitation-1', value: 5_001 },
      { invitationId: 'invitation-2', value: 5_000 },
    ])

    await expect(getWorkspaceMovePreflight('workspace-1', 'org-1')).rejects.toMatchObject({
      code: 'invitation-volume-exceeded',
      message: expect.stringContaining('none were migrated'),
    })
  })
})

describe('pending invitation destination identity', () => {
  it('matches by email and organization without splitting internal/external intent', () => {
    const dialect = new PgDialect()
    const now = new Date('2026-07-30T12:00:00.000Z')
    const query = dialect.sqlToQuery(
      buildPendingInvitationMergeScopeCondition({
        email: 'Invitee@Example.com',
        organizationId: 'org-1',
        excludeInvitationId: 'invite-source',
        now,
      })!
    )

    expect(query.sql).not.toContain('membership_intent')
    expect(query.sql).toContain(' > ')
    expect(query.params).toContain('invitee@example.com')
    expect(query.params).toContain('org-1')
    expect(query.params).toContain(now)
    expect(query.params).not.toContain('internal')
    expect(query.params).not.toContain('external')
  })

  it('never selects an unrelated personal invitation as a merge target', () => {
    expect(
      buildPendingInvitationMergeScopeCondition({
        email: 'invitee@example.com',
        organizationId: null,
        excludeInvitationId: 'invite-source',
      })
    ).toBeUndefined()
  })
})

describe('workspace-move pending seat projection', () => {
  it('includes existing destination pending seats plus distinct incoming internal invitees', () => {
    expect(
      projectDestinationPendingSeatCount({
        currentDestinationPendingSeats: 1,
        destinationOrganizationId: 'org-1',
        movedWorkspaceInvitations: [
          {
            email: 'new@example.com',
            organizationId: null,
            membershipIntent: 'internal',
          },
          {
            email: 'NEW@example.com',
            organizationId: 'org-source',
            membershipIntent: 'internal',
          },
          {
            email: 'external@example.com',
            organizationId: null,
            membershipIntent: 'external',
          },
        ],
        existingDestinationInternalEmails: [],
        existingMemberEmails: [],
      })
    ).toBe(2)
  })

  it('does not double-count internal invitees already pending in the destination', () => {
    expect(
      projectDestinationPendingSeatCount({
        currentDestinationPendingSeats: 2,
        destinationOrganizationId: 'org-1',
        movedWorkspaceInvitations: [
          {
            email: 'already@example.com',
            organizationId: null,
            membershipIntent: 'internal',
          },
          {
            email: 'stamped@example.com',
            organizationId: 'org-1',
            membershipIntent: 'internal',
          },
        ],
        existingDestinationInternalEmails: ['ALREADY@example.com', 'stamped@example.com'],
        existingMemberEmails: [],
      })
    ).toBe(2)
  })

  it('counts an incoming internal invite when the destination invite is only external', () => {
    expect(
      projectDestinationPendingSeatCount({
        currentDestinationPendingSeats: 0,
        destinationOrganizationId: 'org-1',
        movedWorkspaceInvitations: [
          {
            email: 'upgrade@example.com',
            organizationId: null,
            membershipIntent: 'internal',
          },
        ],
        // External destination invitations are deliberately absent from this
        // set because migration promotes their intent to internal.
        existingDestinationInternalEmails: [],
        existingMemberEmails: [],
      })
    ).toBe(1)
  })

  it('does not count an incoming internal invitee who belongs to another organization', () => {
    expect(
      projectDestinationPendingSeatCount({
        currentDestinationPendingSeats: 1,
        destinationOrganizationId: 'org-1',
        movedWorkspaceInvitations: [
          {
            email: 'member@example.com',
            organizationId: null,
            membershipIntent: 'internal',
          },
        ],
        existingDestinationInternalEmails: [],
        existingMemberEmails: ['MEMBER@example.com'],
      })
    ).toBe(1)
  })
})

describe('migrated invitation email outbox', () => {
  it('re-reads the surviving invitation and sends its final grants', async () => {
    getInvitationById.mockResolvedValue({
      id: 'invite-surviving',
      status: 'pending',
      token: 'final-token',
      kind: 'workspace',
      email: 'invitee@example.com',
      inviterName: 'Workspace Admin',
      inviterEmail: 'admin@example.com',
      organizationId: 'org-1',
      role: 'member',
      expiresAt: new Date(Date.now() + 60_000),
      grants: [
        { workspaceId: 'workspace-1', permission: 'write' },
        { workspaceId: 'workspace-2', permission: 'read' },
      ],
    })
    isInvitationExpired.mockReturnValue(false)
    sendInvitationEmail.mockResolvedValue({ success: true })

    await invitationMigrationOutboxHandlers[MIGRATED_INVITATION_EMAIL_EVENT_TYPE](
      { invitationId: 'invite-surviving' },
      {} as never
    )

    expect(sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationId: 'invite-surviving',
        token: 'final-token',
        grants: [
          { workspaceId: 'workspace-1', permission: 'write' },
          { workspaceId: 'workspace-2', permission: 'read' },
        ],
      })
    )
  })

  it('skips a split token that was cancelled before the settle window elapsed', async () => {
    getInvitationById.mockResolvedValue({
      id: 'invite-transient',
      status: 'cancelled',
    })

    await invitationMigrationOutboxHandlers[MIGRATED_INVITATION_EMAIL_EVENT_TYPE](
      { invitationId: 'invite-transient' },
      {} as never
    )

    expect(sendInvitationEmail).not.toHaveBeenCalled()
  })
})

describe('moveWorkspaceToOrganization retries', () => {
  it('returns the existing destination summary without repeating side effects', async () => {
    queueMoveSelects(movedWorkspace)

    const result = await moveWorkspaceToOrganization({
      workspaceId: movedWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
    })

    expect(result.workspace).toMatchObject({
      id: movedWorkspace.id,
      organizationId: destination.id,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
    })
    expect(enqueueOrReschedulePendingOutboxEvent).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
    expect(invalidateWorkspaceTableLimitsCache).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
  })

  it('repairs the idempotent move audit when a committed move is retried after response loss', async () => {
    queueMoveSelects(movedWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: movedWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      auditOperationId: 'operation-1',
    })

    expect(recordAuditOnce).toHaveBeenCalledWith(
      `operation-1:workspace-move:${movedWorkspace.id}`,
      expect.objectContaining({
        action: 'workspace.updated',
        metadata: expect.objectContaining({ recoveredAfterResponseLoss: true }),
      })
    )
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('persists a standalone operation marker atomically with a new move', async () => {
    queueMoveSelects(personalWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: personalWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      expectedOwnerId: personalWorkspace.ownerId,
      auditOperationId: 'operation-1',
      operationCorrelationId: 'operation-1',
      durableOperationId: 'operation-1',
    })

    expect(dbChainMockFns.values.mock.calls.map(([values]) => values)).toContainEqual(
      expect.objectContaining({
        id: 'operation-1',
        eventType: 'admin.workspace-move-operation',
        status: 'completed',
        payload: {
          request: {
            workspaceId: personalWorkspace.id,
            destinationOrganizationId: destination.id,
            expectedOwnerId: personalWorkspace.ownerId,
          },
          audit: {
            actor: { id: null, name: 'Admin Panel', email: 'admin@sim.ai' },
            previousBillingOwnerId: personalWorkspace.billedAccountUserId,
            newBillingOwnerId: destination.ownerId,
            organizationAssignedAt: expect.any(String),
          },
        },
      })
    )
  })

  it('refuses a move that would exceed the locked Enterprise seat capacity', async () => {
    queueMoveSelects(personalWorkspace)
    queueTableRows(subscription, [
      { id: 'subscription-1', plan: 'enterprise', status: 'active', metadata: { seats: 1 } },
    ])
    queueTableRows(member, [{ value: 1 }])
    queueTableRows(invitation, [])
    queueTableRows(invitation, [])
    queueTableRows(invitationWorkspaceGrant, [
      {
        id: 'invitation-1',
        email: 'new-seat@example.com',
        organizationId: null,
        membershipIntent: 'internal',
        permission: 'read',
      },
    ])
    queueTableRows(invitationWorkspaceGrant, [{ invitationId: 'invitation-1', value: 1 }])
    resolveSeatCapacity.mockResolvedValueOnce(1)

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: personalWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({ code: 'seat-capacity-exceeded' })

    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
  })

  it('does not let a new operation ID claim a workspace moved by another operation', async () => {
    queueMoveSelects(movedWorkspace)

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: movedWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
        expectedOwnerId: movedWorkspace.ownerId,
        auditOperationId: 'operation-2',
        operationCorrelationId: 'operation-2',
        durableOperationId: 'operation-2',
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({
      code: 'already-organization-workspace',
    })

    expect(recordAuditOnce).not.toHaveBeenCalled()
  })

  it('recovers an already-moved workspace only for its exact durable operation', async () => {
    queueMoveSelects(movedWorkspace)
    queueTableRows(outboxEvent, [
      {
        eventType: 'admin.workspace-move-operation',
        status: 'completed',
        payload: {
          request: {
            workspaceId: movedWorkspace.id,
            destinationOrganizationId: destination.id,
            expectedOwnerId: movedWorkspace.ownerId,
          },
          audit: {
            actor: { id: null, name: 'Admin Panel', email: 'admin@sim.ai' },
            previousBillingOwnerId: personalWorkspace.billedAccountUserId,
            newBillingOwnerId: destination.ownerId,
            organizationAssignedAt: '2026-08-20T00:00:00.000Z',
          },
        },
      },
    ])

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: movedWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
        expectedOwnerId: movedWorkspace.ownerId,
        auditOperationId: 'operation-1',
        operationCorrelationId: 'operation-1',
        durableOperationId: 'operation-1',
      })
    ).resolves.toMatchObject({ workspace: { id: movedWorkspace.id } })
  })

  it('keeps a completed move recoverable after a later workspace-owner change', async () => {
    const currentWorkspace = { ...movedWorkspace, ownerId: 'new-owner' }
    queueTableRows(outboxEvent, [
      {
        eventType: 'admin.workspace-move-operation',
        status: 'completed',
        payload: {
          request: {
            workspaceId: movedWorkspace.id,
            destinationOrganizationId: destination.id,
            expectedOwnerId: movedWorkspace.ownerId,
          },
          audit: {
            actor: { id: null, name: 'Admin Panel', email: 'admin@sim.ai' },
            previousBillingOwnerId: personalWorkspace.billedAccountUserId,
            newBillingOwnerId: destination.ownerId,
            organizationAssignedAt: '2026-08-20T00:00:00.000Z',
          },
        },
      },
    ])
    queueTableRows(workspace, [currentWorkspace])
    queueTableRows(workspace, [currentWorkspace])
    queueTableRows(organization, [destination])

    await expect(
      getWorkspaceMoveOperation(
        movedWorkspace.id,
        destination.id,
        movedWorkspace.ownerId,
        'operation-1'
      )
    ).resolves.toMatchObject({ workspace: { id: movedWorkspace.id, ownerId: 'new-owner' } })
    expect(recordAuditOnce).toHaveBeenCalledWith(
      `operation-1:workspace-move:${movedWorkspace.id}`,
      expect.objectContaining({
        actorEmail: 'admin@sim.ai',
        metadata: expect.objectContaining({ requestOperationId: 'operation-1' }),
      })
    )
  })

  it('takes shared advisory locks before the workspace row lock and payer mutation', async () => {
    queueMoveSelects(personalWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: personalWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
    })

    const advisoryLock = acquireInvitationMutationLocks.mock.invocationCallOrder[0]
    const firstForUpdate = dbChainMockFns.for.mock.invocationCallOrder[0]
    const payerMutation = changeWorkspaceStoragePayerInTx.mock.invocationCallOrder[0]
    expect(advisoryLock).toBeGreaterThan(0)
    expect(firstForUpdate).toBeGreaterThan(advisoryLock)
    expect(firstForUpdate).toBeGreaterThan(0)
    expect(payerMutation).toBeGreaterThan(firstForUpdate)
  })

  it('rejects a stale batch selection when workspace ownership changed', async () => {
    queueMoveSelects({ ...personalWorkspace, ownerId: 'new-owner' })

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: personalWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
        expectedOwnerId: personalWorkspace.ownerId,
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({
      code: 'workspace-owner-changed',
    })

    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
