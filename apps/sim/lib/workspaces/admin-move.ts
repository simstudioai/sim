import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  permissions,
  subscription,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { PERMISSION_RANK, type PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, count, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { enqueueOutboxEvent, type OutboxHandler } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { getInvitationById } from '@/lib/invitations/core'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { sendInvitationEmail } from '@/lib/invitations/send'
import { invalidateWorkspaceTableLimitsCache } from '@/lib/table/billing'
import {
  mergeInvitationMembershipIntent,
  mergeInvitationRole,
  partitionInvitationGrantsForWorkspaceMove,
} from '@/lib/workspaces/invitation-migration-plan'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('AdminWorkspaceMove')
const ENTITLED_STATUSES = ['active', 'past_due'] as const

export class WorkspaceMoveError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'workspace-not-found'
      | 'organization-not-found'
      | 'workspace-archived'
      | 'already-organization-workspace'
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

interface InvitationMigrationEvent {
  invitationId: string
  outcome: 'migrated' | 'split' | 'merged'
  relatedInvitationId?: string
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
  invitationEvents: InvitationMigrationEvent[]
  summary: WorkspaceMovePreflight
}

export const MIGRATED_INVITATION_EMAIL_EVENT_TYPE = 'invitation.send-migrated-link'

class InvitationSetChangedError extends Error {
  constructor(readonly invitationIds: string[]) {
    super('Pending invitation set changed while acquiring workspace move locks')
    this.name = 'InvitationSetChangedError'
  }
}

/** Returns movable personal/grandfathered workspaces by case-insensitive name or exact UUID. */
export async function searchWorkspaceMoveCandidates(
  search: string,
  limit = 20
): Promise<WorkspaceMoveCandidate[]> {
  const query = search.trim()
  if (!query) return []

  return db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      workspaceMode: workspace.workspaceMode,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .where(
      and(
        isNull(workspace.archivedAt),
        ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
        or(eq(workspace.id, query), ilike(workspace.name, `%${query}%`))
      )
    )
    .orderBy(asc(workspace.name))
    .limit(Math.min(Math.max(limit, 1), 50))
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
        plan: subscription.plan,
        status: subscription.status,
        metadata: subscription.metadata,
      })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, destinationOrganizationId),
          inArray(subscription.status, [...ENTITLED_STATUSES])
        )
      )
      .limit(1),
  ])

  const pendingInternalCount = invitationRows.filter(
    (row) => row.membershipIntent === 'internal'
  ).length
  const seatCapacity = getEnterpriseSeatCapacity(subscriptionRows[0])
  const currentMembers = memberCountRows[0]?.value ?? 0
  const warning =
    seatCapacity !== null && currentMembers + pendingInternalCount > seatCapacity
      ? `${pendingInternalCount} pending internal invitation${pendingInternalCount === 1 ? '' : 's'} could exceed the ${seatCapacity}-seat Enterprise capacity when accepted.`
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
    invitations: invitationRows,
    warning,
  }
}

/**
 * Moves one workspace and migrates every pending grant without changing
 * ownership, historical usage, credentials, storage attribution, or existing
 * collaborator permissions.
 */
export async function moveWorkspaceToOrganization(params: {
  workspaceId: string
  destinationOrganizationId: string
  adminEmail: string
}): Promise<WorkspaceMovePreflight & { invitationEmailFailures: string[] }> {
  let candidateInvitationIds = await findInvitationMigrationLockIds(
    params.workspaceId,
    params.destinationOrganizationId
  )
  let result: MoveTransactionResult | undefined

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      result = await db.transaction(async (tx) => {
        // Acceptance takes invitation/workspace locks before the organization
        // lock. Use the identical order here so a concurrent accept and move
        // cannot wait on one another in opposite directions.
        await acquireInvitationMutationLocks(tx, {
          invitationIds: candidateInvitationIds,
          workspaceIds: [params.workspaceId],
        })
        await acquireOrganizationMutationLock(tx, params.destinationOrganizationId)

        const currentInvitationIds = await findInvitationMigrationLockIds(
          params.workspaceId,
          params.destinationOrganizationId,
          tx
        )
        if (currentInvitationIds.some((id) => !candidateInvitationIds.includes(id))) {
          throw new InvitationSetChangedError(currentInvitationIds)
        }

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
          .for('update')
          .limit(1)

        if (!workspaceRow) {
          throw new WorkspaceMoveError('Workspace not found', 'workspace-not-found')
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
          return {
            performedMove: false,
            previousBillingOwnerId: workspaceRow.billedAccountUserId,
            destinationOwnerId: destination.ownerId,
            organizationAssignedAt: null,
            invitationEvents: [],
            summary: await getMovedWorkspaceSummary(tx, params.workspaceId, destination),
          } satisfies MoveTransactionResult
        }

        const lockedInvitationIds = await lockCurrentPendingInvitations(tx, params.workspaceId)
        const now = new Date()
        const migration = await migratePendingInvitations(tx, {
          workspaceId: params.workspaceId,
          destinationOrganizationId: params.destinationOrganizationId,
          invitationIds: lockedInvitationIds,
          now,
        })
        for (const invitationId of migration.invitationsToEmail) {
          await enqueueOutboxEvent(tx, MIGRATED_INVITATION_EMAIL_EVENT_TYPE, { invitationId })
        }

        await tx
          .update(workspace)
          .set({
            organizationId: params.destinationOrganizationId,
            workspaceMode: WORKSPACE_MODE.ORGANIZATION,
            billedAccountUserId: destination.ownerId,
            organizationAssignedAt: now,
            updatedAt: now,
          })
          .where(eq(workspace.id, params.workspaceId))

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
          invitationEvents: migration.invitationEvents,
          summary: await getMovedWorkspaceSummary(tx, params.workspaceId, destination),
        } satisfies MoveTransactionResult
      })
      break
    } catch (error) {
      if (!(error instanceof InvitationSetChangedError)) throw error
      candidateInvitationIds = error.invitationIds
    }
  }

  if (!result) {
    throw new Error('Pending invitations kept changing; retry the workspace move')
  }

  const invitationEmailFailures: string[] = []
  if (!result.performedMove) {
    logger.info('Workspace was already in destination organization', {
      workspaceId: params.workspaceId,
      destinationOrganizationId: params.destinationOrganizationId,
    })
    return { ...result.summary, invitationEmailFailures }
  }

  invalidateWorkspaceTableLimitsCache(params.workspaceId)

  recordAudit({
    workspaceId: params.workspaceId,
    actorId: null,
    actorName: 'Admin Panel',
    actorEmail: params.adminEmail,
    action: AuditAction.WORKSPACE_UPDATED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: params.workspaceId,
    description: 'Moved workspace into an organization',
    metadata: {
      destinationOrganizationId: params.destinationOrganizationId,
      previousBillingOwnerId: result.previousBillingOwnerId,
      newBillingOwnerId: result.destinationOwnerId,
      organizationAssignedAt: result.organizationAssignedAt?.toISOString(),
    },
  })

  for (const event of result.invitationEvents) {
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: null,
      actorName: 'Admin Panel',
      actorEmail: params.adminEmail,
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
    invitationEmailFailures: invitationEmailFailures.length,
  })

  return { ...result.summary, invitationEmailFailures }
}

async function searchWorkspaceById(workspaceId: string): Promise<WorkspaceMoveCandidate[]> {
  return db
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
}

function assertWorkspaceMovable(row: { archivedAt?: Date | null; workspaceMode: string }): void {
  if (row.archivedAt) {
    throw new WorkspaceMoveError('Archived workspaces cannot be moved', 'workspace-archived')
  }
  if (row.workspaceMode === WORKSPACE_MODE.ORGANIZATION) {
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
      membershipIntent: invitation.membershipIntent,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitationWorkspaceGrant)
    .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
    .where(
      and(eq(invitationWorkspaceGrant.workspaceId, workspaceId), eq(invitation.status, 'pending'))
    )

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
  const countById = new Map(counts.map((row) => [row.invitationId, row.value]))

  return rows.map((row) => ({
    ...row,
    workspaceGrantCount: countById.get(row.id) ?? 1,
  }))
}

function getEnterpriseSeatCapacity(row?: {
  plan: string
  status: string | null
  metadata: unknown
}): number | null {
  if (!row || row.plan !== 'enterprise' || !ENTITLED_STATUSES.includes(row.status as 'active')) {
    return null
  }
  if (!row.metadata || typeof row.metadata !== 'object') return null
  const seats = (row.metadata as Record<string, unknown>).seats
  const parsed = typeof seats === 'number' ? seats : Number(seats)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Lock the source invitations plus every pending invitation for the same
 * invitees. Those rows are potential split/merge targets and acceptance locks
 * the same invitation IDs, so a destination invite cannot be accepted while a
 * move is appending a grant to it.
 */
async function findInvitationMigrationLockIds(
  workspaceId: string,
  _destinationOrganizationId: string,
  executor: DbOrTx = db
): Promise<string[]> {
  const sourceRows = await executor
    .select({ id: invitation.id, email: invitation.email })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(eq(invitation.status, 'pending'), eq(invitationWorkspaceGrant.workspaceId, workspaceId))
    )
  if (sourceRows.length === 0) return []

  const emails = [...new Set(sourceRows.map((row) => normalizeEmail(row.email)))]
  const relatedRows = await executor
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.status, 'pending'),
        or(...emails.map((email) => sql`lower(${invitation.email}) = ${email}`))
      )
    )
  return [
    ...new Set([...sourceRows.map((row) => row.id), ...relatedRows.map((row) => row.id)]),
  ].sort()
}

async function lockCurrentPendingInvitations(tx: DbOrTx, workspaceId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: invitation.id })
    .from(invitation)
    .innerJoin(invitationWorkspaceGrant, eq(invitationWorkspaceGrant.invitationId, invitation.id))
    .where(
      and(eq(invitation.status, 'pending'), eq(invitationWorkspaceGrant.workspaceId, workspaceId))
    )
    .orderBy(invitation.id)
    .for('update')
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

  for (const invitationId of params.invitationIds) {
    const [source] = await tx
      .select()
      .from(invitation)
      .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
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

    const existingDestination = await findPendingInvitationForScope(tx, {
      email: source.email,
      organizationId: params.destinationOrganizationId,
      membershipIntent: source.membershipIntent,
      excludeInvitationId: source.id,
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
          membershipIntent: source.membershipIntent,
          excludeInvitationId: source.id,
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
    membershipIntent: 'internal' | 'external'
    excludeInvitationId: string
  }
) {
  const scope = params.organizationId
    ? eq(invitation.organizationId, params.organizationId)
    : isNull(invitation.organizationId)
  const [row] = await tx
    .select({
      id: invitation.id,
      membershipIntent: invitation.membershipIntent,
      role: invitation.role,
    })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${normalizeEmail(params.email)}`,
        eq(invitation.status, 'pending'),
        eq(invitation.membershipIntent, params.membershipIntent),
        ne(invitation.id, params.excludeInvitationId),
        scope
      )
    )
    .orderBy(invitation.createdAt)
    .limit(1)
  return row ?? null
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

const sendMigratedInvitationLink: OutboxHandler<{ invitationId: string }> = async (payload) => {
  const migrated = await getInvitationById(payload.invitationId)
  if (!migrated || migrated.status !== 'pending') return
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
  const [workspaceRow] = await executor
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      workspaceMode: workspace.workspaceMode,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!workspaceRow) {
    throw new WorkspaceMoveError('Moved workspace could not be reloaded', 'workspace-not-found')
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
    invitations: await getPendingInvitationSummaries(workspaceId, executor),
    warning: null,
  }
}
