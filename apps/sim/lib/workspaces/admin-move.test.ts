/** @vitest-environment node */

import { organization, workspace } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import {
  buildPendingInvitationMergeScopeCondition,
  classifyWorkspaceMoveState,
  moveWorkspaceToOrganization,
} from '@/lib/workspaces/admin-move'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

vi.unmock('drizzle-orm')

const {
  recordAudit,
  enqueueOutboxEvent,
  invalidateWorkspaceTableLimitsCache,
  changeWorkspaceStoragePayerInTx,
} = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
  invalidateWorkspaceTableLimitsCache: vi.fn(),
  changeWorkspaceStoragePayerInTx: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/audit', () => ({
  AuditAction: { WORKSPACE_UPDATED: 'workspace.updated', INVITATION_UPDATED: 'invitation.updated' },
  AuditResourceType: { WORKSPACE: 'workspace' },
  recordAudit,
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))
vi.mock('@/lib/billing/storage/payer-transfer', () => ({ changeWorkspaceStoragePayerInTx }))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent }))
vi.mock('@/lib/invitations/core', () => ({ getInvitationById: vi.fn() }))
vi.mock('@/lib/invitations/locks', () => ({ acquireInvitationMutationLocks: vi.fn() }))
vi.mock('@/lib/invitations/send', () => ({ sendInvitationEmail: vi.fn() }))
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
 * The move flow reads the workspace three times in order — the pre-lock
 * `FOR UPDATE` select (rows ignored), the classification row, and the final
 * summary reload — so the workspace queue gets one set per read. All
 * invitation/grant/permission selects resolve the queue-less empty default.
 */
function queueMoveSelects(workspaceRow: Record<string, unknown>) {
  queueTableRows(workspace, [workspaceRow])
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

  it('keeps archived personal workspaces ineligible for a new move', () => {
    expect(() =>
      classifyWorkspaceMoveState(
        { workspaceMode: WORKSPACE_MODE.PERSONAL, organizationId: null, archivedAt: new Date() },
        'org-1'
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkspaceMoveError>>({ code: 'workspace-archived' })
    )
  })
})

describe('pending invitation destination identity', () => {
  it('matches by email and organization without splitting internal/external intent', () => {
    const dialect = new PgDialect()
    const query = dialect.sqlToQuery(
      buildPendingInvitationMergeScopeCondition({
        email: 'Invitee@Example.com',
        organizationId: 'org-1',
        excludeInvitationId: 'invite-source',
      })!
    )

    expect(query.sql).not.toContain('membership_intent')
    expect(query.params).toContain('invitee@example.com')
    expect(query.params).toContain('org-1')
    expect(query.params).not.toContain('internal')
    expect(query.params).not.toContain('external')
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

  it('pre-locks a nonzero workspace before changing its storage payer', async () => {
    queueMoveSelects(personalWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: personalWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
    })

    // The first `.for('update')` in the move path is the workspace pre-lock
    // select (the earlier invitation-scan selects carry no row lock), so its
    // invocation order against the payer mutation proves lock-before-payer.
    const firstForUpdate = dbChainMockFns.for.mock.invocationCallOrder[0]
    const payerMutation = changeWorkspaceStoragePayerInTx.mock.invocationCallOrder[0]
    expect(firstForUpdate).toBeGreaterThan(0)
    expect(payerMutation).toBeGreaterThan(firstForUpdate)
  })
})
