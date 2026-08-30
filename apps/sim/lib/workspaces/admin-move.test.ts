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
  resolveMoveEntitlements,
  findCrossOrgForkEdges,
  findUnpublishableCustomBlocks,
  findSourceOrgCustomBlocksForWorkspace,
  cleanupSourceOrganizationArtifactsTx,
  deleteCustomBlock,
  acquireOrganizationMutationLock,
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
  collectWorkspaceCredentialSummary,
} = vi.hoisted(() => ({
  resolveMoveEntitlements: vi.fn(() =>
    Promise.resolve({
      sourceIsEnterprise: false,
      destinationIsEnterprise: false,
      capabilitiesLost: [] as string[],
    })
  ),
  findCrossOrgForkEdges: vi.fn(() => Promise.resolve([])),
  findUnpublishableCustomBlocks: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  findSourceOrgCustomBlocksForWorkspace: vi.fn(() => Promise.resolve([])),
  cleanupSourceOrganizationArtifactsTx: vi.fn(() =>
    Promise.resolve({ detachedPermissionGroupIds: [] })
  ),
  deleteCustomBlock: vi.fn(),
  acquireOrganizationMutationLock: vi.fn(),
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
  collectWorkspaceCredentialSummary: vi.fn(),
}))

const EMPTY_CREDENTIALS = {
  items: [] as Array<{
    id: string
    displayName: string
    type: string
    backedBySourceOrgMember: boolean
  }>,
  credentialGroupCount: 0,
  environmentVariableKeys: [] as string[],
  byokKeyCount: 0,
  truncatedCredentials: 0,
  truncatedEnvironmentVariableKeys: 0,
}

const POPULATED_CREDENTIALS = {
  ...EMPTY_CREDENTIALS,
  items: [
    { id: 'credential-1', displayName: 'Slack', type: 'oauth', backedBySourceOrgMember: true },
  ],
  credentialGroupCount: 1,
  environmentVariableKeys: ['OPENAI_API_KEY'],
  byokKeyCount: 2,
}

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKSPACE_UPDATED: 'workspace.updated',
    INVITATION_UPDATED: 'invitation.updated',
    ORGANIZATION_UPDATED: 'organization.updated',
    CUSTOM_BLOCK_DELETED: 'custom_block.deleted',
  },
  AuditResourceType: {
    WORKSPACE: 'workspace',
    ORGANIZATION: 'organization',
    CUSTOM_BLOCK: 'custom_block',
  },
  recordAudit,
  recordAuditOnce,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock,
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
vi.mock('@/lib/workflows/custom-blocks/operations', () => ({ deleteCustomBlock }))
vi.mock('@/lib/workspaces/admin-move-source-impact', () => ({
  cleanupSourceOrganizationArtifactsTx,
  collectWorkspaceCredentialSummary,
  countRetentionRulesForWorkspace: vi.fn(() => ({
    piiRedactionRules: 0,
    retentionOverrides: 0,
  })),
  findAttachedPermissionGroups: vi.fn(() => Promise.resolve([])),
  findCrossOrgForkEdges,
  findRetainedCollaboratorCaps: vi.fn(() => Promise.resolve([])),
  findUnpublishableCustomBlocks,
  findSourceOrgCustomBlocksForWorkspace,
  getSourceOrganization: vi.fn(() =>
    Promise.resolve({
      id: 'org-source',
      name: 'Source',
      ownerId: 'source-owner',
      ownerName: 'Source Owner',
      ownerEmail: 'source-owner@example.com',
    })
  ),
  resolveMoveEntitlements,
  willBrandingChange: vi.fn(() => Promise.resolve(false)),
}))

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

/** Organization-owned source, for the org-to-org path. */
const organizationWorkspace = {
  ...movedWorkspace,
  name: 'Organization workspace',
  workspaceMode: WORKSPACE_MODE.ORGANIZATION,
  organizationId: 'org-source',
  billedAccountUserId: 'source-org-owner',
}

const destination = {
  id: 'org-1',
  name: 'Destination',
  ownerId: 'org-owner',
  ownerName: 'Organization Owner',
  ownerEmail: 'org-owner@example.com',
}

/**
 * The move flow reads the workspace three times in order: the optimistic
 * pre-transaction organization read that decides which organizations to lock,
 * the locked classification row, and the final summary reload. The workspace
 * queue therefore gets one set per read, in that order.
 *
 * Keep this comment in step with the reads — a stale count silently shifts
 * every later queue entry onto the wrong statement, which surfaces as an
 * unrelated "could not be reloaded" failure rather than a queueing error.
 *
 * All invitation/grant/permission selects resolve the queue-less empty default.
 */
function queueMoveSelects(workspaceRow: Record<string, unknown>) {
  queueTableRows(workspace, [workspaceRow])
  queueTableRows(workspace, [workspaceRow])
  queueTableRows(workspace, [workspaceRow])
  queueTableRows(organization, [destination])
}

/**
 * The reload path reads the completed operation, then the workspace twice — the
 * applied-state check and the summary reload — and the destination once.
 */
function queueMoveOperationSelects(audit: Record<string, unknown>) {
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
        audit,
      },
    },
  ])
  queueTableRows(workspace, [movedWorkspace])
  queueTableRows(workspace, [movedWorkspace])
  queueTableRows(organization, [destination])
}

afterAll(resetDbChainMock)

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  /**
   * `vi.clearAllMocks` clears call records but keeps implementations, so a
   * `mockResolvedValue` set by one case would otherwise leak into every case
   * after it. The entitlement resolver is the dangerous one: leaking a
   * downgrade verdict turns unrelated moves into `destination-entitlement-
   * downgrade` failures that depend on test order.
   */
  resolveMoveEntitlements.mockResolvedValue({
    sourceIsEnterprise: false,
    destinationIsEnterprise: false,
    capabilitiesLost: [],
  })
  collectWorkspaceCredentialSummary.mockResolvedValue(EMPTY_CREDENTIALS)
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

  it('classifies a workspace owned by a different organization as a move', () => {
    expect(
      classifyWorkspaceMoveState(
        {
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId: 'org-1',
          archivedAt: null,
        },
        'org-2'
      )
    ).toBe('move')
  })

  it('rejects a drifted organization mode when no organization is assigned', () => {
    expect(() =>
      classifyWorkspaceMoveState(
        {
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId: null,
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

  it('reports a pending invitation as a blocker for an organization-owned source', async () => {
    queueTableRows(workspace, [organizationWorkspace])
    queueTableRows(organization, [destination])
    queueTableRows(invitationWorkspaceGrant, [
      {
        id: 'invitation-1',
        email: 'invitee@example.com',
        organizationId: 'org-source',
        membershipIntent: 'internal',
        permission: 'read',
      },
    ])

    const preflight = await getWorkspaceMovePreflight(organizationWorkspace.id, destination.id)

    expect(preflight.blockers).toEqual([expect.stringContaining('pending invitation')])
    expect(preflight.sourceOrganization).toMatchObject({ id: 'org-source' })
  })

  it('reports no invitation blocker for a personal source', async () => {
    queueTableRows(workspace, [personalWorkspace])
    queueTableRows(organization, [destination])
    queueTableRows(invitationWorkspaceGrant, [
      {
        id: 'invitation-1',
        email: 'invitee@example.com',
        organizationId: null,
        membershipIntent: 'internal',
        permission: 'read',
      },
    ])

    const preflight = await getWorkspaceMovePreflight(personalWorkspace.id, destination.id)

    expect(preflight.blockers).toEqual([])
    expect(preflight.sourceOrganization).toBeNull()
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
            /**
             * Persisted so a reload of a completed operation can still name the
             * organization the workspace came from — the payer transfer has
             * already overwritten `workspace.organizationId` by then.
             */
            sourceOrganizationId: null,
            /** Persisted so the reload path can replay the source-org audit. */
            unpublishedCustomBlocks: [],
            detachedPermissionGroupIds: [],
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

  /**
   * A completed move records `sourceOrganizationId` even when it is `null`, so
   * a reload can tell "this workspace came from a personal source" apart from
   * "this operation predates the field". Collapsing the two made every reload
   * of a personal-source move claim its origin had failed to persist.
   */
  it('does not warn about an unpersisted source for a move recorded as personal', async () => {
    queueMoveOperationSelects({
      actor: { id: null, name: 'Admin Panel', email: 'admin@sim.ai' },
      previousBillingOwnerId: personalWorkspace.billedAccountUserId,
      newBillingOwnerId: destination.ownerId,
      organizationAssignedAt: '2026-08-20T00:00:00.000Z',
      sourceOrganizationId: null,
    })

    const view = await getWorkspaceMoveOperation(
      movedWorkspace.id,
      destination.id,
      movedWorkspace.ownerId,
      'operation-1'
    )

    expect(view.notices).toEqual([])
    expect(view.sourceOrganization).toBeNull()
  })

  it('still warns when the payload never recorded a source organization', async () => {
    queueMoveOperationSelects({
      actor: { id: null, name: 'Admin Panel', email: 'admin@sim.ai' },
      previousBillingOwnerId: personalWorkspace.billedAccountUserId,
      newBillingOwnerId: destination.ownerId,
      organizationAssignedAt: '2026-08-20T00:00:00.000Z',
    })

    const view = await getWorkspaceMoveOperation(
      movedWorkspace.id,
      destination.id,
      movedWorkspace.ownerId,
      'operation-1'
    )

    expect(view.notices).toEqual([
      'This move was recorded before the source organization was persisted, so it cannot be reported.',
    ])
  })

  it('reports the workspace credentials when a completed operation is reloaded', async () => {
    collectWorkspaceCredentialSummary.mockResolvedValueOnce(POPULATED_CREDENTIALS)
    queueMoveOperationSelects({
      actor: { id: null, name: 'Admin Panel', email: 'admin@sim.ai' },
      previousBillingOwnerId: personalWorkspace.billedAccountUserId,
      newBillingOwnerId: destination.ownerId,
      organizationAssignedAt: '2026-08-20T00:00:00.000Z',
      sourceOrganizationId: 'org-source',
    })

    const view = await getWorkspaceMoveOperation(
      movedWorkspace.id,
      destination.id,
      movedWorkspace.ownerId,
      'operation-1'
    )

    /** Resolved against the recorded source, so `backedBySourceOrgMember` means something. */
    expect(collectWorkspaceCredentialSummary).toHaveBeenCalledWith(movedWorkspace.id, 'org-source')
    expect(view.credentials).toEqual(POPULATED_CREDENTIALS)
  })

  it('reports the workspace credentials in the applied summary', async () => {
    queueMoveSelects(organizationWorkspace)
    collectWorkspaceCredentialSummary.mockResolvedValueOnce(POPULATED_CREDENTIALS)

    const summary = await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    /** The PRE-move organization: that is what `backedBySourceOrgMember` compares against. */
    expect(collectWorkspaceCredentialSummary).toHaveBeenCalledWith(
      organizationWorkspace.id,
      'org-source',
      expect.anything()
    )
    expect(summary.credentials).toEqual(POPULATED_CREDENTIALS)
  })

  it('reports the workspace credentials on a retry of a completed move', async () => {
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
            sourceOrganizationId: null,
          },
        },
      },
    ])
    collectWorkspaceCredentialSummary.mockResolvedValueOnce(POPULATED_CREDENTIALS)

    const summary = await moveWorkspaceToOrganization({
      workspaceId: movedWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      expectedOwnerId: movedWorkspace.ownerId,
      auditOperationId: 'operation-1',
      operationCorrelationId: 'operation-1',
      durableOperationId: 'operation-1',
    })

    expect(summary.credentials).toEqual(POPULATED_CREDENTIALS)
    expect(summary.notices).toEqual([])
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

  it('locks both organizations in ascending id order, after invitation locks and before the row lock', async () => {
    queueMoveSelects(organizationWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    const lockedOrganizationIds = acquireOrganizationMutationLock.mock.calls.map(
      (call) => call[1] as string
    )
    expect(lockedOrganizationIds).toEqual(['org-1', 'org-source'])
    const invitationLock = acquireInvitationMutationLocks.mock.invocationCallOrder[0]
    const firstOrganizationLock = acquireOrganizationMutationLock.mock.invocationCallOrder[0]
    const firstForUpdate = dbChainMockFns.for.mock.invocationCallOrder[0]
    expect(firstOrganizationLock).toBeGreaterThan(invitationLock)
    expect(firstForUpdate).toBeGreaterThan(firstOrganizationLock)
  })

  it('fences the payer transfer on the source organization it read under the locks', async () => {
    queueMoveSelects(organizationWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    expect(changeWorkspaceStoragePayerInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: destination.id,
        expectedCurrentPayer: {
          organizationId: 'org-source',
          billedAccountUserId: organizationWorkspace.billedAccountUserId,
        },
      })
    )
  })

  it('records the loss in the source organization audit view, not the destination', async () => {
    queueMoveSelects(organizationWorkspace)
    findSourceOrgCustomBlocksForWorkspace.mockResolvedValueOnce([
      { id: 'block-1', type: 'custom_block_1', name: 'Reporter' },
    ] as never)

    await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    /**
     * `workspaceId: null` + `metadata.organizationId` is the org-level branch
     * of `buildOrgScopeCondition`. The workspace-scoped move entry resolves to
     * the destination after the move, so without these the organization that
     * lost the workspace would have no record of it.
     */
    const entries = recordAudit.mock.calls.map((call) => call[0])
    expect(entries).toContainEqual(
      expect.objectContaining({
        workspaceId: null,
        action: 'organization.updated',
        resourceId: 'org-source',
        metadata: expect.objectContaining({ organizationId: 'org-source' }),
      })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        workspaceId: null,
        action: 'custom_block.deleted',
        resourceId: 'block-1',
        metadata: expect.objectContaining({ organizationId: 'org-source' }),
      })
    )
  })

  it('records no source-organization entry for a personal source', async () => {
    queueMoveSelects(personalWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: personalWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
    })

    expect(recordAudit.mock.calls.map((call) => call[0])).not.toContainEqual(
      expect.objectContaining({ action: 'organization.updated' })
    )
  })

  it('reports the source organization in the applied summary', async () => {
    queueMoveSelects(organizationWorkspace)

    const summary = await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    /**
     * The summary reloads the workspace AFTER the payer transfer has rewritten
     * `organizationId`, so the source is only reportable if it was captured
     * beforehand and threaded through.
     */
    expect(summary.sourceOrganization).toMatchObject({ id: 'org-source' })
  })

  it('re-fences the payer transfer after a SourceOrganizationChangedError retry', async () => {
    /**
     * The optimistic pre-transaction organization read decides which
     * organizations get locked. When the workspace moves between that read and
     * the locked read, the attempt must abort and retry — otherwise the payer
     * transfer is fenced on an organization the workspace has already left, and
     * `changeWorkspaceStoragePayerInTx`'s optimistic check is the only thing
     * standing between that and a corrupted storage ledger.
     *
     * First locked read reports a different organization than the pre-read, so
     * the loop retries; the second attempt fences on the organization it
     * actually observed under the locks.
     */
    queueTableRows(workspace, [organizationWorkspace])
    queueTableRows(workspace, [{ ...organizationWorkspace, organizationId: 'org-moved' }])
    queueTableRows(workspace, [{ ...organizationWorkspace, organizationId: 'org-moved' }])
    queueTableRows(workspace, [{ ...organizationWorkspace, organizationId: 'org-moved' }])
    queueTableRows(organization, [destination])

    await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    expect(changeWorkspaceStoragePayerInTx).toHaveBeenCalledTimes(1)
    expect(changeWorkspaceStoragePayerInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedCurrentPayer: expect.objectContaining({ organizationId: 'org-moved' }),
      })
    )
  })

  it('unpublishes source-organization custom blocks bound to the moving workspace', async () => {
    queueMoveSelects(organizationWorkspace)
    findSourceOrgCustomBlocksForWorkspace.mockResolvedValueOnce([
      { id: 'block-1', type: 'custom_block_1', name: 'Reporter' },
    ] as never)

    await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    expect(deleteCustomBlock).toHaveBeenCalledWith('block-1', expect.anything())
    expect(cleanupSourceOrganizationArtifactsTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceOrganizationId: 'org-source' })
    )
  })

  it('refuses a cross-organization fork edge without mutating anything', async () => {
    queueMoveSelects(organizationWorkspace)
    findCrossOrgForkEdges.mockResolvedValueOnce([
      {
        workspaceId: 'parent-1',
        name: 'Parent',
        organizationId: 'org-source',
        direction: 'parent',
      },
    ] as never)

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: organizationWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
        durableOperationId: 'operation-1',
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({ code: 'fork-lineage-conflict' })

    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
    expect(deleteCustomBlock).not.toHaveBeenCalled()
  })

  it('refuses a cross-organization fork edge on a PERSONAL source too', async () => {
    queueMoveSelects(personalWorkspace)
    findCrossOrgForkEdges.mockResolvedValueOnce([
      { workspaceId: 'parent-1', name: 'Parent', organizationId: 'org-other', direction: 'parent' },
    ] as never)

    /**
     * A personal workspace whose parent has since moved into an organization
     * still produces a cross-org edge. Gating the check on an organization
     * source let the transaction accept a move preflight had already refused.
     */
    await expect(
      moveWorkspaceToOrganization({
        workspaceId: personalWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({ code: 'fork-lineage-conflict' })

    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
  })

  it('does not fence a move when both organizations are equally entitled', async () => {
    queueMoveSelects(organizationWorkspace)
    /**
     * Not `...Once`: the resolver runs twice, once before the transaction for
     * preflight reporting and again under the locks as the fence. A `...Once`
     * here is consumed by the pre-transaction call, leaving the fence on the
     * default mock and making this assert nothing.
     *
     * The fence must key off `capabilitiesLost`, never off Enterprise being
     * present on both sides or a `subscription` row existing. Deployment
     * configuration grants entitlement with no rows at all (see
     * `resolveMoveEntitlements` and its own suite), so a fence that read
     * either signal directly would reject EVERY organization-to-organization
     * move in those modes.
     */
    resolveMoveEntitlements.mockResolvedValue({
      sourceIsEnterprise: true,
      destinationIsEnterprise: true,
      capabilitiesLost: [],
    })

    await moveWorkspaceToOrganization({
      workspaceId: organizationWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
      durableOperationId: 'operation-1',
    })

    expect(changeWorkspaceStoragePayerInTx).toHaveBeenCalledTimes(1)
  })

  it('refuses an organization source without a durable operation id', async () => {
    queueMoveSelects(organizationWorkspace)

    /**
     * The source organization's audit is written after commit and cannot be
     * reconstructed once the workspace has left, so the durable payload is the
     * only place its id survives a crash. Unreachable in production (both
     * non-durable callers select through `ownedAttachableWorkspacesWhere`,
     * which requires a null `organizationId`), and pinned here so a new caller
     * that forgets the id fails loudly instead of losing the record.
     */
    await expect(
      moveWorkspaceToOrganization({
        workspaceId: organizationWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
      })
    ).rejects.toThrow(/without a durable operation id/)

    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
  })

  it('refuses an entitlement downgrade without mutating anything', async () => {
    queueMoveSelects(organizationWorkspace)
    /**
     * Not `...Once`: the resolver runs twice — once before the transaction for
     * preflight reporting, and again under the locks as the fence.
     */
    resolveMoveEntitlements.mockResolvedValue({
      sourceIsEnterprise: true,
      destinationIsEnterprise: false,
      capabilitiesLost: ['permission groups', 'workspace forking'],
    })

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: organizationWorkspace.id,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@sim.ai',
        durableOperationId: 'operation-1',
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({
      code: 'destination-entitlement-downgrade',
    })

    expect(changeWorkspaceStoragePayerInTx).not.toHaveBeenCalled()
  })

  it('leaves the personal source path untouched', async () => {
    queueMoveSelects(personalWorkspace)

    await moveWorkspaceToOrganization({
      workspaceId: personalWorkspace.id,
      destinationOrganizationId: destination.id,
      adminEmail: 'admin@sim.ai',
    })

    expect(acquireOrganizationMutationLock.mock.calls.map((call) => call[1])).toEqual([
      destination.id,
    ])
    expect(deleteCustomBlock).not.toHaveBeenCalled()
    expect(cleanupSourceOrganizationArtifactsTx).not.toHaveBeenCalled()
    expect(changeWorkspaceStoragePayerInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedCurrentPayer: {
          organizationId: null,
          billedAccountUserId: personalWorkspace.billedAccountUserId,
        },
      })
    )
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
