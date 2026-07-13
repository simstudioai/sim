/** @vitest-environment node */

import {
  invitation,
  invitationWorkspaceGrant,
  organization,
  permissions,
  workspace,
} from '@sim/db/schema'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceMoveError } from '@/lib/workspaces/admin-move'
import {
  buildPendingInvitationMergeScopeCondition,
  classifyWorkspaceMoveState,
  moveWorkspaceToOrganization,
} from '@/lib/workspaces/admin-move'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

vi.unmock('drizzle-orm')

const {
  mockDb,
  recordAudit,
  enqueueOutboxEvent,
  invalidateWorkspaceTableLimitsCache,
  changeWorkspaceStoragePayerInTx,
} = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  recordAudit: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
  invalidateWorkspaceTableLimitsCache: vi.fn(),
  changeWorkspaceStoragePayerInTx: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: mockDb }))
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

let selectedWorkspace = movedWorkspace
const operationOrder: string[] = []

function createSelectChain() {
  let source: unknown
  const rows = () => {
    if (source === workspace) return [selectedWorkspace]
    if (source === organization) return [destination]
    if (source === invitation || source === invitationWorkspaceGrant || source === permissions) {
      return []
    }
    return []
  }
  const chain = {
    from(table: unknown) {
      source = table
      return chain
    },
    innerJoin() {
      return chain
    },
    leftJoin() {
      return chain
    },
    where() {
      return chain
    },
    orderBy() {
      return chain
    },
    for() {
      if (source === workspace) operationOrder.push('workspace-lock')
      return chain
    },
    groupBy() {
      return chain
    },
    async limit() {
      return rows()
    },
    then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve(rows()).then(resolve, reject)
    },
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  operationOrder.length = 0
  selectedWorkspace = movedWorkspace
  mockDb.select.mockImplementation(() => createSelectChain())
  mockDb.transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
    callback(mockDb)
  )
  mockDb.update.mockReturnValue({
    set: () => ({
      where: vi.fn().mockResolvedValue([]),
    }),
  })
  mockDb.insert.mockReturnValue({
    values: () => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  })
  changeWorkspaceStoragePayerInTx.mockImplementation(async () => {
    operationOrder.push('payer-mutation')
    return {
      billableBytes: 128,
      newPayer: { type: 'organization', id: destination.id },
      oldPayer: { type: 'user', id: personalWorkspace.billedAccountUserId },
      repairedWorkspaceLedger: false,
    }
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
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
  })

  it('pre-locks a nonzero workspace before changing its storage payer', async () => {
    selectedWorkspace = personalWorkspace

    await moveWorkspaceToOrganization({
      workspaceId: personalWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
    })

    const firstWorkspaceLock = operationOrder.indexOf('workspace-lock')
    const payerMutation = operationOrder.indexOf('payer-mutation')
    expect(firstWorkspaceLock).toBeGreaterThanOrEqual(0)
    expect(payerMutation).toBeGreaterThan(firstWorkspaceLock)
  })
})
