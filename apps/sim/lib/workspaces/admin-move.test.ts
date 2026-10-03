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
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  customBlockOperationsMock,
  customBlockOperationsMockFns,
} from '@sim/testing/mocks/custom-block-operations.mock'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import {
  invitationsSendMock,
  invitationsSendMockFns,
} from '@sim/testing/mocks/invitations-send.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
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
  changeWorkspaceStoragePayerInTx,
  acquireInvitationMutationLocks,
  countPendingSeatInvitations,
  resolveSeatCapacity,
  collectWorkspaceCredentialSummary,
  getSourceOrganization,
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
  changeWorkspaceStoragePayerInTx: vi.fn(),
  acquireInvitationMutationLocks: vi.fn(),
  countPendingSeatInvitations: vi.fn(() => Promise.resolve(0)),
  resolveSeatCapacity: vi.fn(() => Promise.resolve(10)),
  collectWorkspaceCredentialSummary: vi.fn(),
  getSourceOrganization: vi.fn(),
}))

const { mockRecordAudit: recordAudit, mockRecordAuditOnce: recordAuditOnce } = auditMockFns
const { mockAcquireOrganizationMutationLock: acquireOrganizationMutationLock } =
  organizationMembershipMockFns
const { mockDeleteCustomBlock: deleteCustomBlock } = customBlockOperationsMockFns
const { mockEnqueueOrReschedulePendingOutboxEvent: enqueueOrReschedulePendingOutboxEvent } =
  outboxServiceMockFns
const { mockInvalidateWorkspaceTableLimitsCache: invalidateWorkspaceTableLimitsCache } =
  tableBillingMockFns
const { mockGetInvitationById: getInvitationById, mockIsInvitationExpired: isInvitationExpired } =
  invitationsCoreMockFns
const { mockSendInvitationEmail: sendInvitationEmail } = invitationsSendMockFns

const SOURCE_ORGANIZATION = {
  id: 'org-source',
  name: 'Source',
  ownerId: 'source-owner',
  ownerName: 'Source Owner',
  ownerEmail: 'source-owner@example.com',
}

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

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/storage/payer-transfer', () => ({ changeWorkspaceStoragePayerInTx }))
vi.mock('@/lib/billing/validation/seat-management', () => ({
  countPendingSeatInvitations,
  planHasFixedSeatCap: vi.fn((plan: string) => plan === 'enterprise'),
  resolveSeatCapacity,
}))
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)
vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
vi.mock('@/lib/invitations/locks', () => ({ acquireInvitationMutationLocks }))
vi.mock('@/lib/invitations/send', () => invitationsSendMock)
vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)
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
  getSourceOrganization,
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
  resetDbChainMock()
  isInvitationExpired.mockReturnValue(false)
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
  getSourceOrganization.mockResolvedValue(SOURCE_ORGANIZATION)
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
