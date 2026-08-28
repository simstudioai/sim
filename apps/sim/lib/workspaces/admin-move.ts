import { AuditAction, AuditResourceType, recordAudit, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  outboxEvent,
  permissions,
  subscription,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { PERMISSION_RANK, type PermissionType } from '@sim/platform-authz/workspace'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import {
  and,
  asc,
  count,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { changeWorkspaceStoragePayerInTx } from '@/lib/billing/storage/payer-transfer'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  hasPaidSubscriptionStatus,
} from '@/lib/billing/subscriptions/utils'
import {
  countPendingSeatInvitations,
  planHasFixedSeatCap,
  resolveSeatCapacity,
} from '@/lib/billing/validation/seat-management'
import {
  addOutboxEventSourceOperationId,
  enqueueOrReschedulePendingOutboxEvent,
  type OutboxHandler,
  outboxEventHasSourceOperationId,
  outboxPayloadHasSourceOperationId,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { getInvitationById, isInvitationExpired } from '@/lib/invitations/core'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { PENDING_INVITATION_UNIQUE_INDEX, sendInvitationEmail } from '@/lib/invitations/send'
import { invalidateWorkspaceTableLimitsCache } from '@/lib/table/billing'
import {
  mergeInvitationMembershipIntent,
  mergeInvitationRole,
  partitionInvitationGrantsForWorkspaceMove,
} from '@/lib/workspaces/invitation-migration-plan'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('AdminWorkspaceMove')
/**
 * A dashboard member add may move several grants from one invitation in
 * consecutive short transactions. Let that split/merge sequence settle before
 * the outbox resolves the live invitation and sends its final token.
 */
const MIGRATED_INVITATION_EMAIL_SETTLE_MS = 60_000
const MAX_WORKSPACE_MOVE_PENDING_INVITATIONS = 1_000
const MAX_WORKSPACE_MOVE_GRANTS_PER_INVITATION = 1_000
const MAX_WORKSPACE_MOVE_TOTAL_INVITATION_GRANTS = 10_000
const MAX_WORKSPACE_MOVE_RELATED_INVITATIONS = 1_000

export class WorkspaceMoveError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'workspace-not-found'
      | 'organization-not-found'
      | 'workspace-owner-changed'
      | 'already-organization-workspace'
      | 'seat-capacity-exceeded'
      | 'invitation-volume-exceeded'
  ) {
    super(message)
    this.name = 'WorkspaceMoveError'
  }
}

export interface WorkspaceMoveCandidate {
  id: string
  name: string
  ownerId: string
  ownerName: string
  ownerEmail: string
  workspaceMode: string
  organizationId: string | null
  billedAccountUserId: string
  /** Archived workspaces are movable; surfaced so admin UIs can label them. */
  archived: boolean
}

export interface WorkspaceMovePreflight {
  workspace: WorkspaceMoveCandidate
  destinationOrganization: {
    id: string
    name: string
    ownerId: string
    ownerName: string
    ownerEmail: string
  }
  collaborators: Array<{
    userId: string
    name: string
    email: string
    permission: 'admin' | 'write' | 'read'
    organizationMember: boolean
  }>
  invitations: Array<{
    id: string
    email: string
    membershipIntent: 'internal' | 'external'
    permission: 'admin' | 'write' | 'read'
    workspaceGrantCount: number
  }>
  warning: string | null
}

export interface WorkspaceMoveOperationView extends WorkspaceMovePreflight {
  operationId: string
  followUpJobs: {
    selected: number
    completed: number
    pending: number
    failedCount: number
    failed: Array<{
      eventId: string
      invitationId: string
      error: string | null
    }>
  }
}

interface InvitationMigrationEvent {
  invitationId: string
  outcome: 'migrated' | 'split' | 'merged'
  relatedInvitationId?: string
}

interface PendingWorkspaceInvitationSummary {
  id: string
  email: string
  organizationId: string | null
  membershipIntent: 'internal' | 'external'
  permission: 'admin' | 'write' | 'read'
  workspaceGrantCount: number
}

interface WorkspaceMoveDestination {
  id: string
  name: string
  ownerId: string
  ownerName: string
  ownerEmail: string
}

interface MoveTransactionResult {
  performedMove: boolean
  previousBillingOwnerId: string
  destinationOwnerId: string
  organizationAssignedAt: Date | null
  durableAudit: AdminWorkspaceMoveOperationPayload['audit'] | null
  invitationEvents: InvitationMigrationEvent[]
  summary: WorkspaceMovePreflight
}

export const MIGRATED_INVITATION_EMAIL_EVENT_TYPE = 'invitation.send-migrated-link'
export const ADMIN_WORKSPACE_MOVE_OPERATION_EVENT_TYPE = 'admin.workspace-move-operation'

interface AdminWorkspaceMoveOperationRequest {
  workspaceId: string
  destinationOrganizationId: string
  expectedOwnerId: string | null
}

interface AdminWorkspaceMoveOperationPayload {
  request: AdminWorkspaceMoveOperationRequest
  audit: {
    actor: { id: string | null; name: string; email: string | null }
    previousBillingOwnerId: string
    newBillingOwnerId: string
    organizationAssignedAt: string
  }
}

function parseAdminWorkspaceMoveOperationPayload(
  payload: unknown
): AdminWorkspaceMoveOperationPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const request = record.request
  const audit = record.audit
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    !audit ||
    typeof audit !== 'object' ||
    Array.isArray(audit)
  ) {
    return null
  }
  const requestRecord = request as Record<string, unknown>
  const auditRecord = audit as Record<string, unknown>
  const actor = auditRecord.actor
  if (
    typeof requestRecord.workspaceId !== 'string' ||
    typeof requestRecord.destinationOrganizationId !== 'string' ||
    (requestRecord.expectedOwnerId !== null && typeof requestRecord.expectedOwnerId !== 'string') ||
    !actor ||
    typeof actor !== 'object' ||
    Array.isArray(actor) ||
    typeof auditRecord.previousBillingOwnerId !== 'string' ||
    typeof auditRecord.newBillingOwnerId !== 'string' ||
    typeof auditRecord.organizationAssignedAt !== 'string'
  ) {
    return null
  }
  const actorRecord = actor as Record<string, unknown>
  if (
    (actorRecord.id !== null && typeof actorRecord.id !== 'string') ||
    typeof actorRecord.name !== 'string' ||
    (actorRecord.email !== null && typeof actorRecord.email !== 'string')
  ) {
    return null
  }
  return {
    request: {
      workspaceId: requestRecord.workspaceId,
      destinationOrganizationId: requestRecord.destinationOrganizationId,
      expectedOwnerId: requestRecord.expectedOwnerId,
    },
    audit: {
      actor: {
        id: actorRecord.id,
        name: actorRecord.name,
        email: actorRecord.email,
      },
      previousBillingOwnerId: auditRecord.previousBillingOwnerId,
      newBillingOwnerId: auditRecord.newBillingOwnerId,
      organizationAssignedAt: auditRecord.organizationAssignedAt,
    },
  }
}

function workspaceMoveOperationMatches(
  payload: unknown,
  params: AdminWorkspaceMoveOperationRequest
): boolean {
  const parsed = parseAdminWorkspaceMoveOperationPayload(payload)
  return (
    parsed?.request.workspaceId === params.workspaceId &&
    parsed.request.destinationOrganizationId === params.destinationOrganizationId &&
    parsed.request.expectedOwnerId === params.expectedOwnerId
  )
}

class InvitationSetChangedError extends Error {
  constructor(readonly invitationIds: string[]) {
    super('Pending invitation set changed while acquiring workspace move locks')
    this.name = 'InvitationSetChangedError'
  }
}

function isConcurrentPendingInvitationInsert(error: unknown): boolean {
  return (
    getPostgresErrorCode(error) === '23505' &&
    getPostgresConstraintName(error) === PENDING_INVITATION_UNIQUE_INDEX
  )
}

/** Returns movable personal/grandfathered workspaces by case-insensitive name or exact UUID. */
export async function searchWorkspaceMoveCandidates(search: string, limit = 20, offset = 0) {
  const query = search.trim()
  if (!query) {
    return { data: [], pagination: { total: 0, limit, offset, hasMore: false } }
  }

  const rows = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      workspaceMode: workspace.workspaceMode,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .where(
      and(
        ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
        isNull(workspace.organizationId),
        or(eq(workspace.id, query), ilike(workspace.name, `%${query}%`))
      )
    )
    .orderBy(asc(workspace.name))
    .limit(Math.min(Math.max(limit, 1), 50))
    .offset(Math.max(offset, 0))

  const boundedLimit = Math.min(Math.max(limit, 1), 50)
  const total = rows[0]?.total ?? 0
  return {
    data: rows.map(({ archivedAt, total: _total, ...row }) => ({
      ...row,
      archived: archivedAt !== null,
    })),
    pagination: {
      total,
      limit: boundedLimit,
      offset: Math.max(offset, 0),
      hasMore: Math.max(offset, 0) + rows.length < total,
    },
  }
}

/** Builds the human-reviewable summary shown before a workspace move. */
export async function getWorkspaceMovePreflight(
  workspaceId: string,
  destinationOrganizationId: string
): Promise<WorkspaceMovePreflight> {
  const workspaceRows = await searchWorkspaceById(workspaceId)
  const workspaceRow = workspaceRows[0]
  if (!workspaceRow) {
    throw new WorkspaceMoveError('Workspace not found', 'workspace-not-found')
  }
  assertWorkspaceMovable(workspaceRow)

  const destination = await getDestinationOrganization(destinationOrganizationId)
  if (!destination) {
    throw new WorkspaceMoveError('Destination organization not found', 'organization-not-found')
  }

  const [collaboratorRows, invitationRows, memberCountRows, subscriptionRows] = await Promise.all([
    db
      .select({
        userId: permissions.userId,
        name: user.name,
        email: user.email,
        permission: permissions.permissionType,
        memberId: member.id,
      })
      .from(permissions)
      .innerJoin(user, eq(user.id, permissions.userId))
      .leftJoin(
        member,
        and(
          eq(member.userId, permissions.userId),
          eq(member.organizationId, destinationOrganizationId)
        )
      )
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))
      .orderBy(asc(user.email)),
    getPendingInvitationSummaries(workspaceId),
    db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, destinationOrganizationId)),
    db
      .select({
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        metadata: subscription.metadata,
      })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, destinationOrganizationId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1),
  ])

  const organizationSubscription = subscriptionRows[0]
  const seatCapacity =
    organizationSubscription &&
    hasPaidSubscriptionStatus(organizationSubscription.status) &&
    planHasFixedSeatCap(organizationSubscription.plan)
      ? await resolveSeatCapacity(organizationSubscription)
      : null
  const currentMembers = memberCountRows[0]?.value ?? 0
  const projectedPendingInternalSeats =
    seatCapacity === null
      ? 0
      : await getProjectedDestinationPendingSeatCount({
          destinationOrganizationId,
          movedWorkspaceInvitations: invitationRows,
        })
  const warning =
    seatCapacity !== null && currentMembers + projectedPendingInternalSeats > seatCapacity
      ? `This move is blocked: ${currentMembers} current member${currentMembers === 1 ? '' : 's'} plus ${projectedPendingInternalSeats} pending internal invitation reservation${projectedPendingInternalSeats === 1 ? '' : 's'} exceed the ${seatCapacity}-seat Enterprise capacity.`
      : null

  return {
    workspace: workspaceRow,
    destinationOrganization: destination,
    collaborators: collaboratorRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      permission: row.permission,
      organizationMember: row.memberId !== null,
    })),
    invitations: invitationRows.map(({ organizationId: _organizationId, ...row }) => row),
    warning,
  }
}

/**
 * Moves one workspace and migrates every pending grant. Workspace ownership,
 * historical usage, credentials, and collaborator permissions are preserved;
 * the current billing/storage payer changes to the destination organization.
 */
export async function moveWorkspaceToOrganization(params: {
  workspaceId: string
  destinationOrganizationId: string
  adminEmail: string
  auditActor?: { id: string | null; name: string; email: string | null }
  /** Makes the move audit recoverable if the DB commit succeeds before the caller gets a response. */
  auditOperationId?: string
  operationCorrelationId?: string
  /** Persists a standalone Admin operation marker atomically with the move. */
  durableOperationId?: string
  /** Reject a stale batch selection instead of moving a newly owned workspace. */
  expectedOwnerId?: string
}): Promise<WorkspaceMovePreflight> {
  let candidateInvitationIds = await findInvitationMigrationLockIds(
    params.workspaceId,
    params.destinationOrganizationId
  )
  let result: MoveTransactionResult | undefined

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      result = await db.transaction(async (tx) => {
        // Acceptance takes invitation/workspace advisory locks before it
        // row-locks the workspace. Keep the exact same order here: taking the
        // row lock first can deadlock when acceptance owns an invitation lock,
        // waits for the workspace row, and this move waits for that invitation.
        await acquireInvitationMutationLocks(tx, {
          invitationIds: candidateInvitationIds,
          workspaceIds: [params.workspaceId],
        })
        await acquireOrganizationMutationLock(tx, params.destinationOrganizationId)

        const durableOperationRequest: AdminWorkspaceMoveOperationRequest = {
          workspaceId: params.workspaceId,
          destinationOrganizationId: params.destinationOrganizationId,
          expectedOwnerId: params.expectedOwnerId ?? null,
        }
        const [existingDurableOperation] = params.durableOperationId
          ? await tx
              .select({
                eventType: outboxEvent.eventType,
                status: outboxEvent.status,
                payload: outboxEvent.payload,
              })
              .from(outboxEvent)
              .where(eq(outboxEvent.id, params.durableOperationId))
              .for('update')
              .limit(1)
          : []
        if (
          existingDurableOperation &&
          (existingDurableOperation.eventType !== ADMIN_WORKSPACE_MOVE_OPERATION_EVENT_TYPE ||
            existingDurableOperation.status !== 'completed' ||
            !workspaceMoveOperationMatches(
              existingDurableOperation.payload,
              durableOperationRequest
            ))
        ) {
          throw new WorkspaceMoveError(
            'Workspace move operation ID is already bound to different parameters',
            'already-organization-workspace'
          )
        }

        const currentInvitationIds = await findInvitationMigrationLockIds(
          params.workspaceId,
          params.destinationOrganizationId,
          tx
        )
        if (currentInvitationIds.some((id) => !candidateInvitationIds.includes(id))) {
          throw new InvitationSetChangedError(currentInvitationIds)
        }

        /**
         * `FOR NO KEY UPDATE`, not `FOR UPDATE`: the workspace row is a
         * foreign-key parent, so concurrent writers hold an implicit
         * `FOR KEY SHARE` on it. See the module header of
         * `lib/billing/storage/tracking.ts`.
         */
        const [workspaceRow] = await tx
          .select({
            id: workspace.id,
            ownerId: workspace.ownerId,
            organizationId: workspace.organizationId,
            workspaceMode: workspace.workspaceMode,
            billedAccountUserId: workspace.billedAccountUserId,
            archivedAt: workspace.archivedAt,
          })
          .from(workspace)
          .where(eq(workspace.id, params.workspaceId))
          .for('no key update')
          .limit(1)

        if (!workspaceRow) {
          throw new WorkspaceMoveError('Workspace not found', 'workspace-not-found')
        }
        if (params.expectedOwnerId && workspaceRow.ownerId !== params.expectedOwnerId) {
          throw new WorkspaceMoveError(
            'Workspace owner changed after it was selected',
            'workspace-owner-changed'
          )
        }
        const moveState = classifyWorkspaceMoveState(workspaceRow, params.destinationOrganizationId)

        const destination = await getDestinationOrganization(params.destinationOrganizationId, tx)
        if (!destination) {
          throw new WorkspaceMoveError(
            'Destination organization not found',
            'organization-not-found'
          )
        }

        if (moveState === 'already-moved') {
          if (params.durableOperationId && !existingDurableOperation) {
            throw new WorkspaceMoveError(
              'Workspace was already moved outside this confirmed operation',
              'already-organization-workspace'
            )
          }
          return {
            performedMove: false,
            previousBillingOwnerId: workspaceRow.billedAccountUserId,
            destinationOwnerId: destination.ownerId,
            organizationAssignedAt: null,
            durableAudit: existingDurableOperation
              ? (parseAdminWorkspaceMoveOperationPayload(existingDurableOperation.payload)?.audit ??
                null)
              : null,
            invitationEvents: [],
            summary: await getMovedWorkspaceSummary(tx, params.workspaceId, destination),
          } satisfies MoveTransactionResult
        }

        const [enterpriseSubscription] = await tx
          .select({
            id: subscription.id,
            plan: subscription.plan,
            status: subscription.status,
            metadata: subscription.metadata,
          })
          .from(subscription)
          .where(
            and(
              eq(subscription.referenceId, params.destinationOrganizationId),
              eq(subscription.plan, 'enterprise'),
              inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1)
        if (enterpriseSubscription && hasPaidSubscriptionStatus(enterpriseSubscription.status)) {
          const [capacity, memberRows, movedWorkspaceInvitations] = await Promise.all([
            resolveSeatCapacity(enterpriseSubscription, tx),
            tx
              .select({ value: count() })
              .from(member)
              .where(eq(member.organizationId, params.destinationOrganizationId)),
            getPendingInvitationSummaries(params.workspaceId, tx),
          ])
          const projectedPendingSeats = await getProjectedDestinationPendingSeatCount({
            destinationOrganizationId: params.destinationOrganizationId,
            movedWorkspaceInvitations,
            executor: tx,
          })
          const currentMembers = memberRows[0]?.value ?? 0
          if (currentMembers + projectedPendingSeats > capacity) {
            throw new WorkspaceMoveError(
              `Moving this workspace would require ${currentMembers + projectedPendingSeats} occupied or reserved seats, above the ${capacity}-seat Enterprise capacity`,
              'seat-capacity-exceeded'
            )
          }
        }

        const now = new Date()
        await expireLockedPendingInvitations(tx, candidateInvitationIds, now)
        const lockedInvitationIds = await lockCurrentPendingInvitations(tx, params.workspaceId, now)
        const migration = await migratePendingInvitations(tx, {
          workspaceId: params.workspaceId,
          destinationOrganizationId: params.destinationOrganizationId,
          invitationIds: lockedInvitationIds,
          now,
        })
        for (const invitationId of migration.invitationsToEmail) {
          const invitationEmailEventId = await enqueueOrReschedulePendingOutboxEvent(
            tx,
            MIGRATED_INVITATION_EMAIL_EVENT_TYPE,
            {
              invitationId,
              ...(params.operationCorrelationId
                ? { sourceOperationIds: [params.operationCorrelationId] }
                : {}),
            },
            {
              availableAt: new Date(now.getTime() + MIGRATED_INVITATION_EMAIL_SETTLE_MS),
              coalesceOn: { payloadKey: 'invitationId', payloadValue: invitationId },
            }
          )
          if (params.operationCorrelationId) {
            await addOutboxEventSourceOperationId(
              tx,
              invitationEmailEventId,
              params.operationCorrelationId
            )
          }
        }

        await changeWorkspaceStoragePayerInTx(tx, {
          workspaceId: params.workspaceId,
          organizationId: params.destinationOrganizationId,
          billedAccountUserId: destination.ownerId,
          expectedCurrentPayer: {
            organizationId: workspaceRow.organizationId,
            billedAccountUserId: workspaceRow.billedAccountUserId,
          },
        })

        await tx
          .update(workspace)
          .set({
            workspaceMode: WORKSPACE_MODE.ORGANIZATION,
            organizationAssignedAt: now,
            updatedAt: now,
          })
          .where(eq(workspace.id, params.workspaceId))

        const durableAudit: AdminWorkspaceMoveOperationPayload['audit'] | null =
          params.durableOperationId
            ? {
                actor: params.auditActor ?? {
                  id: null,
                  name: 'Admin Panel',
                  email: params.adminEmail,
                },
                previousBillingOwnerId: workspaceRow.billedAccountUserId,
                newBillingOwnerId: destination.ownerId,
                organizationAssignedAt: now.toISOString(),
              }
            : null
        if (params.durableOperationId && durableAudit) {
          await tx.insert(outboxEvent).values({
            id: params.durableOperationId,
            eventType: ADMIN_WORKSPACE_MOVE_OPERATION_EVENT_TYPE,
            payload: { request: durableOperationRequest, audit: durableAudit },
            status: 'completed',
            processedAt: now,
          })
        }

        await tx
          .insert(permissions)
          .values({
            id: generateId(),
            userId: destination.ownerId,
            entityType: 'workspace',
            entityId: params.workspaceId,
            permissionType: 'admin',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [permissions.userId, permissions.entityType, permissions.entityId],
            set: { permissionType: 'admin', updatedAt: now },
          })

        return {
          performedMove: true,
          previousBillingOwnerId: workspaceRow.billedAccountUserId,
          destinationOwnerId: destination.ownerId,
          organizationAssignedAt: now,
          durableAudit,
          invitationEvents: migration.invitationEvents,
          summary: await getMovedWorkspaceSummary(tx, params.workspaceId, destination),
        } satisfies MoveTransactionResult
      })
      break
    } catch (error) {
      if (error instanceof InvitationSetChangedError) {
        candidateInvitationIds = error.invitationIds
        continue
      }
      if (isConcurrentPendingInvitationInsert(error)) {
        candidateInvitationIds = await findInvitationMigrationLockIds(
          params.workspaceId,
          params.destinationOrganizationId
        )
        continue
      }
      throw error
    }
  }

  if (!result) {
    throw new Error('Pending invitations kept changing; retry the workspace move')
  }

  if (!result.performedMove) {
    if (params.auditOperationId && result.durableAudit) {
      await recordDurableWorkspaceMoveAudit(
        params.auditOperationId,
        params.workspaceId,
        params.destinationOrganizationId,
        result.durableAudit
      )
    } else if (params.auditOperationId) {
      await recordWorkspaceMoveAudit({
        params,
        previousBillingOwnerId: null,
        newBillingOwnerId: result.destinationOwnerId,
        organizationAssignedAt: null,
        recovered: true,
      })
    }
    logger.info('Workspace was already in destination organization', {
      workspaceId: params.workspaceId,
      destinationOrganizationId: params.destinationOrganizationId,
    })
    return result.summary
  }

  invalidateWorkspaceTableLimitsCache(params.workspaceId)

  if (params.auditOperationId && result.durableAudit) {
    await recordDurableWorkspaceMoveAudit(
      params.auditOperationId,
      params.workspaceId,
      params.destinationOrganizationId,
      result.durableAudit
    )
  } else {
    await recordWorkspaceMoveAudit({
      params,
      previousBillingOwnerId: result.previousBillingOwnerId,
      newBillingOwnerId: result.destinationOwnerId,
      organizationAssignedAt: result.organizationAssignedAt,
      recovered: false,
    })
  }

  for (const event of result.invitationEvents) {
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.auditActor ? params.auditActor.id : null,
      actorName: params.auditActor?.name ?? 'Admin Panel',
      actorEmail: params.auditActor?.email ?? params.adminEmail,
      action: AuditAction.INVITATION_UPDATED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: event.invitationId,
      description: `Invitation ${event.outcome} during workspace organization move`,
      metadata: {
        outcome: event.outcome,
        relatedInvitationId: event.relatedInvitationId,
        destinationOrganizationId: params.destinationOrganizationId,
      },
    })
  }

  logger.info('Moved workspace into organization', {
    workspaceId: params.workspaceId,
    destinationOrganizationId: params.destinationOrganizationId,
    invitationEvents: result.invitationEvents.length,
  })

  return result.summary
}

async function recordWorkspaceMoveAudit({
  params,
  previousBillingOwnerId,
  newBillingOwnerId,
  organizationAssignedAt,
  recovered,
}: {
  params: {
    workspaceId: string
    destinationOrganizationId: string
    adminEmail: string
    auditActor?: { id: string | null; name: string; email: string | null }
    auditOperationId?: string
  }
  previousBillingOwnerId: string | null
  newBillingOwnerId: string
  organizationAssignedAt: Date | null
  recovered: boolean
}): Promise<void> {
  const audit = {
    workspaceId: params.workspaceId,
    actorId: params.auditActor ? params.auditActor.id : null,
    actorName: params.auditActor?.name ?? 'Admin Panel',
    actorEmail: params.auditActor?.email ?? params.adminEmail,
    action: AuditAction.WORKSPACE_UPDATED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: params.workspaceId,
    description: 'Moved workspace into an organization',
    metadata: {
      destinationOrganizationId: params.destinationOrganizationId,
      previousBillingOwnerId,
      newBillingOwnerId,
      organizationAssignedAt: organizationAssignedAt?.toISOString() ?? null,
      recoveredAfterResponseLoss: recovered,
    },
  } as const
  if (params.auditOperationId) {
    await recordAuditOnce(`${params.auditOperationId}:workspace-move:${params.workspaceId}`, audit)
  } else {
    recordAudit(audit)
  }
}

async function recordDurableWorkspaceMoveAudit(
  operationId: string,
  workspaceId: string,
  destinationOrganizationId: string,
  audit: AdminWorkspaceMoveOperationPayload['audit']
): Promise<void> {
  await recordAuditOnce(`${operationId}:workspace-move:${workspaceId}`, {
    workspaceId,
    actorId: audit.actor.id,
    actorName: audit.actor.name,
    actorEmail: audit.actor.email,
    action: AuditAction.WORKSPACE_UPDATED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: workspaceId,
    description: 'Moved workspace into an organization',
    metadata: {
      destinationOrganizationId,
      previousBillingOwnerId: audit.previousBillingOwnerId,
      newBillingOwnerId: audit.newBillingOwnerId,
      organizationAssignedAt: audit.organizationAssignedAt,
      requestOperationId: operationId,
    },
  })
}

async function getWorkspaceMoveFollowUpJobs(
  operationId: string,
  executor: DbOrTx = db
): Promise<WorkspaceMoveOperationView['followUpJobs']> {
  const [progress] = await executor
    .select({
      selected: count(),
      completed: sql<number>`count(*) filter (where ${outboxEvent.status} = 'completed')`.mapWith(
        Number
      ),
      failed: sql<number>`count(*) filter (where ${outboxEvent.status} = 'dead_letter')`.mapWith(
        Number
      ),
    })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, MIGRATED_INVITATION_EMAIL_EVENT_TYPE),
        outboxEventHasSourceOperationId(operationId)
      )
    )
  const selected = progress?.selected ?? 0
  const completed = progress?.completed ?? 0
  const failedCount = progress?.failed ?? 0
  const failedRows =
    failedCount > 0
      ? await executor
          .select({
            eventId: outboxEvent.id,
            invitationId: sql<string | null>`${outboxEvent.payload} ->> 'invitationId'`,
            error: outboxEvent.lastError,
          })
          .from(outboxEvent)
          .where(
            and(
              eq(outboxEvent.eventType, MIGRATED_INVITATION_EMAIL_EVENT_TYPE),
              eq(outboxEvent.status, 'dead_letter'),
              outboxEventHasSourceOperationId(operationId)
            )
          )
          .orderBy(outboxEvent.createdAt, outboxEvent.id)
          .limit(100)
      : []
  return {
    selected,
    completed,
    pending: Math.max(0, selected - completed - failedCount),
    failedCount,
    failed: failedRows.flatMap((row) =>
      row.invitationId
        ? [
            {
              eventId: row.eventId,
              invitationId: row.invitationId,
              error: row.error,
            },
          ]
        : []
    ),
  }
}

export async function toWorkspaceMoveOperationView(
  summary: WorkspaceMovePreflight,
  operationId: string
): Promise<WorkspaceMoveOperationView> {
  return {
    ...summary,
    operationId,
    followUpJobs: await getWorkspaceMoveFollowUpJobs(operationId),
  }
}

export async function getWorkspaceMoveOperation(
  workspaceId: string,
  destinationOrganizationId: string,
  expectedOwnerId: string | undefined,
  operationId: string
): Promise<WorkspaceMoveOperationView> {
  const [operation] = await db
    .select({
      eventType: outboxEvent.eventType,
      status: outboxEvent.status,
      payload: outboxEvent.payload,
    })
    .from(outboxEvent)
    .where(eq(outboxEvent.id, operationId))
    .limit(1)
  const operationPayload = parseAdminWorkspaceMoveOperationPayload(operation?.payload)
  if (
    operation?.eventType !== ADMIN_WORKSPACE_MOVE_OPERATION_EVENT_TYPE ||
    operation.status !== 'completed' ||
    !operationPayload ||
    !workspaceMoveOperationMatches(operationPayload, {
      workspaceId,
      destinationOrganizationId,
      expectedOwnerId: expectedOwnerId ?? null,
    })
  ) {
    throw new WorkspaceMoveError(
      'Workspace move has not been applied with these confirmed parameters',
      'workspace-owner-changed'
    )
  }
  const [workspaceRow] = await searchWorkspaceById(workspaceId)
  if (!workspaceRow) throw new WorkspaceMoveError('Workspace not found', 'workspace-not-found')
  if (
    workspaceRow.organizationId !== destinationOrganizationId ||
    workspaceRow.workspaceMode !== WORKSPACE_MODE.ORGANIZATION
  ) {
    throw new WorkspaceMoveError(
      'Workspace move has not been applied with these confirmed parameters',
      'workspace-owner-changed'
    )
  }
  const destination = await getDestinationOrganization(destinationOrganizationId)
  if (!destination) {
    throw new WorkspaceMoveError('Destination organization not found', 'organization-not-found')
  }
  await recordDurableWorkspaceMoveAudit(
    operationId,
    workspaceId,
    destinationOrganizationId,
    operationPayload.audit
  )
  return toWorkspaceMoveOperationView(
    await getMovedWorkspaceSummary(db, workspaceId, destination),
    operationId
  )
}

export async function retryWorkspaceMoveFollowUpJob(params: {
  workspaceId: string
  destinationOrganizationId: string
  expectedOwnerId?: string
  operationId: string
  jobEventId: string
  actor: { id: string | null; name: string; email: string | null }
}): Promise<WorkspaceMoveOperationView> {
  await getWorkspaceMoveOperation(
    params.workspaceId,
    params.destinationOrganizationId,
    params.expectedOwnerId,
    params.operationId
  )
  const retried = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, params.destinationOrganizationId)
    const [job] = await tx
      .select({
        status: outboxEvent.status,
        eventType: outboxEvent.eventType,
        payload: outboxEvent.payload,
      })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, params.jobEventId))
      .for('update')
      .limit(1)
    if (
      !job ||
      job.eventType !== MIGRATED_INVITATION_EMAIL_EVENT_TYPE ||
      !outboxPayloadHasSourceOperationId(job.payload, params.operationId)
    ) {
      throw new Error('Workspace-move follow-up job not found')
    }
    if (job.status !== 'dead_letter') return false
    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
      })
      .where(eq(outboxEvent.id, params.jobEventId))
    return true
  })
  if (retried) {
    await recordAuditOnce(`${params.operationId}:follow-up-retry:${params.jobEventId}`, {
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorEmail: params.actor.email,
      action: AuditAction.INVITATION_UPDATED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: params.workspaceId,
      workspaceId: params.workspaceId,
      description: 'Admin retried a migrated invitation email after a workspace move',
      metadata: {
        destinationOrganizationId: params.destinationOrganizationId,
        operationId: params.operationId,
        jobEventId: params.jobEventId,
      },
    })
  }
  return getWorkspaceMoveOperation(
    params.workspaceId,
    params.destinationOrganizationId,
    params.expectedOwnerId,
    params.operationId
  )
}

async function searchWorkspaceById(workspaceId: string): Promise<WorkspaceMoveCandidate[]> {
  const rows = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      workspaceMode: workspace.workspaceMode,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }))
}

/**
 * Archived workspaces are deliberately movable: leaving them behind keeps an
 * unarchive-later escape hatch outside the organization's purview, and
 * join-attach already sweeps them (`includeArchived`).
 */
function assertWorkspaceMovable(row: {
  archivedAt?: Date | null
  workspaceMode: string
  organizationId?: string | null
}): void {
  if (
    row.workspaceMode === WORKSPACE_MODE.ORGANIZATION ||
    (row.organizationId !== undefined && row.organizationId !== null)
  ) {
    throw new WorkspaceMoveError(
      'Inter-organization workspace transfers are not supported',
      'already-organization-workspace'
    )
  }
}

export function classifyWorkspaceMoveState(
  row: { archivedAt?: Date | null; workspaceMode: string; organizationId: string | null },
  destinationOrganizationId: string
): 'move' | 'already-moved' {
  if (
    row.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    row.organizationId === destinationOrganizationId
  ) {
    return 'already-moved'
  }
  assertWorkspaceMovable(row)
  return 'move'
}

async function getDestinationOrganization(
  organizationId: string,
  executor: DbOrTx = db
): Promise<WorkspaceMoveDestination | null> {
  const [row] = await executor
    .select({
      id: organization.id,
      name: organization.name,
      ownerId: member.userId,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.role, 'owner')))
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(organization.id, organizationId))
    .limit(1)
  return row ?? null
}

async function getPendingInvitationSummaries(workspaceId: string, executor: DbOrTx = db) {
  const rows = await executor
    .select({
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organizationId,
      membershipIntent: invitation.membershipIntent,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitationWorkspaceGrant)
    .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
    .where(
      and(
        eq(invitationWorkspaceGrant.workspaceId, workspaceId),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date())
      )
    )
    .limit(MAX_WORKSPACE_MOVE_PENDING_INVITATIONS + 1)

  if (rows.length > MAX_WORKSPACE_MOVE_PENDING_INVITATIONS) {
    throw new WorkspaceMoveError(
      `This workspace has more than ${MAX_WORKSPACE_MOVE_PENDING_INVITATIONS.toLocaleString()} pending invitations. Resolve or cancel older invitations before moving it; none were migrated.`,
      'invitation-volume-exceeded'
    )
  }

  if (rows.length === 0) return []
  const counts = await executor
    .select({ invitationId: invitationWorkspaceGrant.invitationId, value: count() })
    .from(invitationWorkspaceGrant)
    .where(
      inArray(
        invitationWorkspaceGrant.invitationId,
        rows.map((row) => row.id)
      )
    )
    .groupBy(invitationWorkspaceGrant.invitationId)
  const totalGrantCount = counts.reduce((total, row) => total + row.value, 0)
  if (totalGrantCount > MAX_WORKSPACE_MOVE_TOTAL_INVITATION_GRANTS) {
    throw new WorkspaceMoveError(
      `The pending invitations on this workspace cover more than ${MAX_WORKSPACE_MOVE_TOTAL_INVITATION_GRANTS.toLocaleString()} workspace grants. Resolve or cancel older invitations before moving it; none were migrated.`,
      'invitation-volume-exceeded'
    )
  }
  const countById = new Map(counts.map((row) => [row.invitationId, row.value]))

  return rows.map((row) => ({
    ...row,
    workspaceGrantCount: countById.get(row.id) ?? 1,
  }))
}

/**
 * Projects the destination's live pending-seat count after this workspace's
 * invitation grants are migrated.
 *
 * The canonical count already includes every live internal invitation stamped
 * with the destination. The only additions are distinct internal invitees from
 * another scope that are neither current members of any organization nor
 * already represented by a destination-internal invitation. Multiple personal
 * invitations for one email collapse into one destination invitation during
 * migration, so the delta is email-distinct.
 */
export function projectDestinationPendingSeatCount(params: {
  currentDestinationPendingSeats: number
  destinationOrganizationId: string
  movedWorkspaceInvitations: Array<{
    email: string
    organizationId: string | null
    membershipIntent: 'internal' | 'external'
  }>
  existingDestinationInternalEmails: string[]
  existingMemberEmails: string[]
}): number {
  const existingDestinationSeatEmails = new Set(
    [...params.existingDestinationInternalEmails, ...params.existingMemberEmails].map(
      normalizeEmail
    )
  )
  const incomingInternalEmails = new Set(
    params.movedWorkspaceInvitations
      .filter(
        (row) =>
          row.membershipIntent === 'internal' &&
          row.organizationId !== params.destinationOrganizationId
      )
      .map((row) => normalizeEmail(row.email))
  )
  const incomingSeatDelta = [...incomingInternalEmails].filter(
    (email) => !existingDestinationSeatEmails.has(email)
  ).length
  return params.currentDestinationPendingSeats + incomingSeatDelta
}

async function getProjectedDestinationPendingSeatCount(params: {
  destinationOrganizationId: string
  movedWorkspaceInvitations: PendingWorkspaceInvitationSummary[]
  executor?: DbOrTx
}): Promise<number> {
  const executor = params.executor ?? db
  const currentDestinationPendingSeats = await countPendingSeatInvitations(
    params.destinationOrganizationId,
    executor
  )
  const incomingInternalEmails = [
    ...new Set(
      params.movedWorkspaceInvitations
        .filter(
          (row) =>
            row.membershipIntent === 'internal' &&
            row.organizationId !== params.destinationOrganizationId
        )
        .map((row) => normalizeEmail(row.email))
    ),
  ]
  if (incomingInternalEmails.length === 0) return currentDestinationPendingSeats

  const [existingDestinationRows, existingMembers] = await Promise.all([
    executor
      .select({ email: invitation.email })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, params.destinationOrganizationId),
          eq(invitation.status, 'pending'),
          eq(invitation.membershipIntent, 'internal'),
          gt(invitation.expiresAt, new Date()),
          or(
            ...incomingInternalEmails.map(
              (email) => sql`lower(${invitation.email}) = ${normalizeEmail(email)}`
            )
          )
        )
      ),
    executor
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        or(
          ...incomingInternalEmails.map(
            (email) => sql`lower(btrim(${user.email})) = ${normalizeEmail(email)}`
          )
        )
      ),
  ])

  return projectDestinationPendingSeatCount({
    currentDestinationPendingSeats,
    destinationOrganizationId: params.destinationOrganizationId,
    movedWorkspaceInvitations: params.movedWorkspaceInvitations,
    existingDestinationInternalEmails: existingDestinationRows.map((row) => row.email),
    existingMemberEmails: existingMembers.map((row) => row.email),
  })
}

/**
 * Lock the source invitations plus pending organization invitations for the
 * same invitees. A legacy source can retain grants in several organization
 * scopes, and redistribution may merge into any of them. Acceptance locks the
 * same invitation IDs, so all possible merge targets must be fenced.
 */
async function findInvitationMigrationLockIds(
  workspaceId: string,
  _destinationOrganizationId: string,
  executor: DbOrTx = db
): Promise<string[]> {
  const now = new Date()
  const sourceRows = await executor
    .select({ id: invitation.id, email: invitation.email })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
        eq(invitationWorkspaceGrant.workspaceId, workspaceId)
      )
    )
    .limit(MAX_WORKSPACE_MOVE_PENDING_INVITATIONS + 1)
  if (sourceRows.length > MAX_WORKSPACE_MOVE_PENDING_INVITATIONS) {
    throw new WorkspaceMoveError(
      `This workspace has more than ${MAX_WORKSPACE_MOVE_PENDING_INVITATIONS.toLocaleString()} pending invitations. Resolve or cancel older invitations before moving it; none were migrated.`,
      'invitation-volume-exceeded'
    )
  }
  if (sourceRows.length === 0) return []

  const emails = [...new Set(sourceRows.map((row) => normalizeEmail(row.email)))]
  const relatedRows = await executor
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
        or(...emails.map((email) => sql`lower(${invitation.email}) = ${email}`)),
        isNotNull(invitation.organizationId)
      )
    )
    .limit(MAX_WORKSPACE_MOVE_RELATED_INVITATIONS + 1)
  if (relatedRows.length > MAX_WORKSPACE_MOVE_RELATED_INVITATIONS) {
    throw new WorkspaceMoveError(
      `The pending invitations on this workspace have more than ${MAX_WORKSPACE_MOVE_RELATED_INVITATIONS.toLocaleString()} related organization invitations. Resolve or cancel older invitations before moving it; none were migrated.`,
      'invitation-volume-exceeded'
    )
  }
  return [
    ...new Set([...sourceRows.map((row) => row.id), ...relatedRows.map((row) => row.id)]),
  ].sort()
}

async function expireLockedPendingInvitations(
  tx: DbOrTx,
  invitationIds: string[],
  now: Date
): Promise<void> {
  if (invitationIds.length === 0) return
  await tx
    .update(invitation)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        inArray(invitation.id, invitationIds),
        eq(invitation.status, 'pending'),
        lte(invitation.expiresAt, now)
      )
    )
}

async function lockCurrentPendingInvitations(
  tx: DbOrTx,
  workspaceId: string,
  now: Date
): Promise<string[]> {
  const rows = await tx
    .select({ id: invitation.id })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
        eq(invitationWorkspaceGrant.workspaceId, workspaceId)
      )
    )
    .orderBy(invitation.id)
    .for('update')
    .limit(MAX_WORKSPACE_MOVE_PENDING_INVITATIONS + 1)
  if (rows.length > MAX_WORKSPACE_MOVE_PENDING_INVITATIONS) {
    throw new WorkspaceMoveError(
      `This workspace has more than ${MAX_WORKSPACE_MOVE_PENDING_INVITATIONS.toLocaleString()} pending invitations. Resolve or cancel older invitations before moving it; none were migrated.`,
      'invitation-volume-exceeded'
    )
  }
  return [...new Set(rows.map((row) => row.id))]
}

async function migratePendingInvitations(
  tx: DbOrTx,
  params: {
    workspaceId: string
    destinationOrganizationId: string
    invitationIds: string[]
    now: Date
  }
): Promise<{ invitationEvents: InvitationMigrationEvent[]; invitationsToEmail: string[] }> {
  const invitationEvents: InvitationMigrationEvent[] = []
  const invitationsToEmail = new Set<string>()
  let loadedGrantCount = 0

  for (const invitationId of params.invitationIds) {
    const [source] = await tx
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, params.now)
        )
      )
      .limit(1)
    if (!source) continue

    const grants = await tx
      .select({
        id: invitationWorkspaceGrant.id,
        workspaceId: invitationWorkspaceGrant.workspaceId,
        permission: invitationWorkspaceGrant.permission,
        organizationId: workspace.organizationId,
      })
      .from(invitationWorkspaceGrant)
      .innerJoin(workspace, eq(workspace.id, invitationWorkspaceGrant.workspaceId))
      .where(eq(invitationWorkspaceGrant.invitationId, source.id))
      .orderBy(invitationWorkspaceGrant.workspaceId)
      .limit(MAX_WORKSPACE_MOVE_GRANTS_PER_INVITATION + 1)
    if (grants.length > MAX_WORKSPACE_MOVE_GRANTS_PER_INVITATION) {
      throw new WorkspaceMoveError(
        `Pending invitation ${source.id} covers more than ${MAX_WORKSPACE_MOVE_GRANTS_PER_INVITATION.toLocaleString()} workspaces. Resolve or cancel it before moving this workspace; none were migrated.`,
        'invitation-volume-exceeded'
      )
    }
    loadedGrantCount += grants.length
    if (loadedGrantCount > MAX_WORKSPACE_MOVE_TOTAL_INVITATION_GRANTS) {
      throw new WorkspaceMoveError(
        `The pending invitations on this workspace cover more than ${MAX_WORKSPACE_MOVE_TOTAL_INVITATION_GRANTS.toLocaleString()} workspace grants. Resolve or cancel older invitations before moving it; none were migrated.`,
        'invitation-volume-exceeded'
      )
    }

    const existingDestination = await findPendingInvitationForScope(tx, {
      email: source.email,
      organizationId: params.destinationOrganizationId,
      excludeInvitationId: source.id,
      now: params.now,
    })
    const partition = partitionInvitationGrantsForWorkspaceMove({
      grants,
      movedWorkspaceId: params.workspaceId,
      destinationOrganizationId: params.destinationOrganizationId,
      mergesIntoExistingDestination: !!existingDestination,
    })
    const movedGrant = partition.movedGrant
    if (!movedGrant) continue

    if (existingDestination) {
      await mergeInvitationIntent(tx, existingDestination, source, params.now)
      await mergeGrant(tx, existingDestination.id, movedGrant, params.now)
      await tx
        .delete(invitationWorkspaceGrant)
        .where(eq(invitationWorkspaceGrant.id, movedGrant.id))
      invitationsToEmail.add(existingDestination.id)
      invitationEvents.push({
        invitationId: source.id,
        outcome: 'merged',
        relatedInvitationId: existingDestination.id,
      })
    } else {
      await tx
        .update(invitation)
        .set({ organizationId: params.destinationOrganizationId, updatedAt: params.now })
        .where(eq(invitation.id, source.id))
      invitationEvents.push({ invitationId: source.id, outcome: 'migrated' })
    }

    const grantsToRedistribute = partition.redistribute

    if (grantsToRedistribute.length > 0) {
      const groups = groupGrantsByOrganization(grantsToRedistribute)
      for (const [organizationId, scopedGrants] of groups) {
        const sibling = await findPendingInvitationForScope(tx, {
          email: source.email,
          organizationId,
          excludeInvitationId: source.id,
          now: params.now,
        })
        const siblingId =
          sibling?.id ??
          (await createSiblingInvitation(tx, {
            source,
            organizationId,
            now: params.now,
          }))

        if (sibling) {
          await mergeInvitationIntent(tx, sibling, source, params.now)
        }

        for (const grant of scopedGrants) {
          await mergeGrant(tx, siblingId, grant, params.now)
          await tx.delete(invitationWorkspaceGrant).where(eq(invitationWorkspaceGrant.id, grant.id))
        }

        invitationsToEmail.add(siblingId)
        invitationEvents.push({
          invitationId: source.id,
          outcome: sibling ? 'merged' : 'split',
          relatedInvitationId: siblingId,
        })
      }
    }

    if (partition.cancelOriginal) {
      await tx
        .update(invitation)
        .set({ status: 'cancelled', updatedAt: params.now })
        .where(eq(invitation.id, source.id))
    }
  }

  return { invitationEvents, invitationsToEmail: [...invitationsToEmail] }
}

function groupGrantsByOrganization<T extends { organizationId: string | null }>(
  grants: T[]
): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>()
  for (const grant of grants) {
    const scoped = groups.get(grant.organizationId) ?? []
    scoped.push(grant)
    groups.set(grant.organizationId, scoped)
  }
  return groups
}

async function findPendingInvitationForScope(
  tx: DbOrTx,
  params: {
    email: string
    organizationId: string | null
    excludeInvitationId: string
    now: Date
  }
) {
  /**
   * Personal invitations are scoped to the inviter/billing owner, not merely to
   * the email address. There is deliberately no uniqueness constraint for
   * `organization_id IS NULL`, and send.ts never coalesces those invitations.
   * Redistribution must preserve the same rule: create a sibling derived from
   * this source rather than absorbing an unrelated inviter's personal invite.
   */
  if (!params.organizationId) return null

  // Membership intent is deliberately not part of destination identity. A
  // same-email invite for the same organization is one pending claim; merging
  // promotes internal intent and the strongest role via mergeInvitationIntent.
  const condition = buildPendingInvitationMergeScopeCondition(params)
  if (!condition) return null
  const [row] = await tx
    .select({
      id: invitation.id,
      membershipIntent: invitation.membershipIntent,
      role: invitation.role,
    })
    .from(invitation)
    .where(condition)
    .orderBy(invitation.createdAt)
    .for('update')
    .limit(1)
  return row ?? null
}

export function buildPendingInvitationMergeScopeCondition(params: {
  email: string
  organizationId: string | null
  excludeInvitationId: string
  now?: Date
}) {
  if (!params.organizationId) return undefined
  return and(
    sql`lower(${invitation.email}) = ${normalizeEmail(params.email)}`,
    eq(invitation.status, 'pending'),
    gt(invitation.expiresAt, params.now ?? new Date()),
    ne(invitation.id, params.excludeInvitationId),
    eq(invitation.organizationId, params.organizationId)
  )
}

async function mergeInvitationIntent(
  tx: DbOrTx,
  target: { id: string; membershipIntent: 'internal' | 'external'; role: string },
  source: typeof invitation.$inferSelect,
  now: Date
): Promise<void> {
  const membershipIntent = mergeInvitationMembershipIntent(
    target.membershipIntent,
    source.membershipIntent
  )
  const role = mergeInvitationRole(target.role, source.role)
  if (membershipIntent === target.membershipIntent && role === target.role) return

  await tx
    .update(invitation)
    .set({ membershipIntent, role, updatedAt: now })
    .where(eq(invitation.id, target.id))
}

async function createSiblingInvitation(
  tx: DbOrTx,
  params: {
    source: typeof invitation.$inferSelect
    organizationId: string | null
    now: Date
  }
): Promise<string> {
  const id = generateId()
  await tx.insert(invitation).values({
    id,
    kind: params.source.kind,
    email: params.source.email,
    inviterId: params.source.inviterId,
    organizationId: params.organizationId,
    membershipIntent: params.source.membershipIntent,
    role: params.source.role,
    status: 'pending',
    token: generateId(),
    expiresAt: params.source.expiresAt,
    createdAt: params.now,
    updatedAt: params.now,
  })
  return id
}

async function mergeGrant(
  tx: DbOrTx,
  invitationId: string,
  grant: { workspaceId: string; permission: 'admin' | 'write' | 'read' },
  now: Date
): Promise<void> {
  // A surviving merge target may have an invitation email in flight. Touch the
  // invitation even when this grant is already present so any stale failed-send
  // compensation sees a later migration revision and leaves the target intact.
  await tx
    .update(invitation)
    .set({ updatedAt: now })
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))

  const [existing] = await tx
    .select({ id: invitationWorkspaceGrant.id, permission: invitationWorkspaceGrant.permission })
    .from(invitationWorkspaceGrant)
    .where(
      and(
        eq(invitationWorkspaceGrant.invitationId, invitationId),
        eq(invitationWorkspaceGrant.workspaceId, grant.workspaceId)
      )
    )
    .limit(1)

  if (existing) {
    if (
      PERMISSION_RANK[grant.permission as PermissionType] >
      PERMISSION_RANK[existing.permission as PermissionType]
    ) {
      await tx
        .update(invitationWorkspaceGrant)
        .set({ permission: grant.permission, updatedAt: now })
        .where(eq(invitationWorkspaceGrant.id, existing.id))
    }
    return
  }

  await tx.insert(invitationWorkspaceGrant).values({
    id: generateId(),
    invitationId,
    workspaceId: grant.workspaceId,
    permission: grant.permission,
    createdAt: now,
    updatedAt: now,
  })
}

const sendMigratedInvitationLink: OutboxHandler<{
  invitationId: string
  sourceOperationId?: string
  sourceOperationIds?: string[]
}> = async (payload) => {
  const migrated = await getInvitationById(payload.invitationId)
  if (!migrated || migrated.status !== 'pending' || isInvitationExpired(migrated)) return
  const result = await sendInvitationEmail({
    invitationId: migrated.id,
    token: migrated.token,
    kind: migrated.kind,
    email: migrated.email,
    inviterName: migrated.inviterName ?? migrated.inviterEmail ?? 'A workspace administrator',
    organizationId: migrated.organizationId,
    organizationRole: migrated.role === 'admin' ? 'admin' : 'member',
    grants: migrated.grants.map((grant) => ({
      workspaceId: grant.workspaceId,
      permission: grant.permission,
    })),
  })
  if (!result.success) {
    throw new Error(result.error || 'Failed to send migrated invitation link')
  }
}

export const invitationMigrationOutboxHandlers = {
  [MIGRATED_INVITATION_EMAIL_EVENT_TYPE]: sendMigratedInvitationLink as OutboxHandler<unknown>,
} as const

async function getMovedWorkspaceSummary(
  executor: DbOrTx,
  workspaceId: string,
  destination: WorkspaceMoveDestination
): Promise<WorkspaceMovePreflight> {
  const [movedRow] = await executor
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      workspaceMode: workspace.workspaceMode,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!movedRow) {
    throw new WorkspaceMoveError('Moved workspace could not be reloaded', 'workspace-not-found')
  }
  const { archivedAt, ...movedWorkspace } = movedRow
  const workspaceRow: WorkspaceMoveCandidate = {
    ...movedWorkspace,
    archived: archivedAt !== null,
  }

  const collaboratorRows = await executor
    .select({
      userId: permissions.userId,
      name: user.name,
      email: user.email,
      permission: permissions.permissionType,
      memberId: member.id,
    })
    .from(permissions)
    .innerJoin(user, eq(user.id, permissions.userId))
    .leftJoin(
      member,
      and(eq(member.userId, permissions.userId), eq(member.organizationId, destination.id))
    )
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

  return {
    workspace: workspaceRow,
    destinationOrganization: destination,
    collaborators: collaboratorRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      permission: row.permission,
      organizationMember: row.memberId !== null,
    })),
    invitations: (await getPendingInvitationSummaries(workspaceId, executor)).map(
      ({ organizationId: _organizationId, ...row }) => row
    ),
    warning: null,
  }
}
