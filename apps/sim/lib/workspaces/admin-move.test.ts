/** @vitest-environment node */

import { organization, workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import {
  buildPendingInvitationMergeScopeCondition,
  classifyWorkspaceMoveState,
  invitationMigrationOutboxHandlers,
  MIGRATED_INVITATION_EMAIL_EVENT_TYPE,
  moveWorkspaceToOrganization,
} from '@/lib/workspaces/admin-move'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

vi.unmock('drizzle-orm')

const {
  recordAudit,
  enqueueOutboxEvent,
  invalidateWorkspaceTableLimitsCache,
  changeWorkspaceStoragePayerInTx,
  acquireInvitationMutationLocks,
  getInvitationById,
  isInvitationExpired,
  sendInvitationEmail,
} = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
  invalidateWorkspaceTableLimitsCache: vi.fn(),
  changeWorkspaceStoragePayerInTx: vi.fn(),
  acquireInvitationMutationLocks: vi.fn(),
  getInvitationById: vi.fn(),
  isInvitationExpired: vi.fn(() => false),
  sendInvitationEmail: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKSPACE_UPDATED: 'workspace.updated', INVITATION_UPDATED: 'invitation.updated' },
  AuditResourceType: { WORKSPACE: 'workspace' },
  recordAudit,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))
vi.mock('@/lib/billing/storage/payer-transfer', () => ({ changeWorkspaceStoragePayerInTx }))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent }))
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
    expect(enqueueOutboxEvent).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
    expect(invalidateWorkspaceTableLimitsCache).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
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
