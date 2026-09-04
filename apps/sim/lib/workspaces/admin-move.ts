import { AuditAction, AuditResourceType, recordAudit, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import {
  foldedEmail,
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
import { and, asc, count, eq, gt, ilike, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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
import { deleteCustomBlock } from '@/lib/workflows/custom-blocks/operations'
import {
  type CrossOrgForkEdge,
  cleanupSourceOrganizationArtifactsTx,
  collectWorkspaceCredentialSummary,
  countRetentionRulesForWorkspace,
  findAttachedPermissionGroups,
  findCrossOrgForkEdges,
  findRetainedCollaboratorCaps,
  findSourceOrgCustomBlocksForWorkspace,
  findUnpublishableCustomBlocks,
  getSourceOrganization,
  resolveMoveEntitlements,
  willBrandingChange,
} from '@/lib/workspaces/admin-move-source-impact'
import {
  mergeInvitationMembershipIntent,
  mergeInvitationRole,
  partitionInvitationGrantsForWorkspaceMove,
} from '@/lib/workspaces/invitation-migration-plan'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('AdminWorkspaceMove')

/** Second `member` alias so one query can test membership of both organizations. */
const sourceMember = alias(member, 'source_member')

/**
 * Moving a workspace between organizations is the only operation in the product
 * capable of separating an artifact from the organization that owns it, so two
 * invariants that nothing else has ever had to defend are enforced here.
 *
 * **A custom block and its bound workflow always share an organization.**
 * `publishCustomBlock` refuses a workflow outside the target org, so the pair
 * has always been co-located. `getCustomBlockAuthority` resolves by the
 * *consumer's* org and `admitCustomBlockChildExecution` deliberately skips its
 * concurrency reservation because "the consumer and source workspaces are always
 * in the same organization" — a stranded row would run a foreign tenant's
 * workflow under its owner's credentials, billed to the wrong payer. The move
 * therefore unpublishes every source-org block bound to the moving workspace.
 *
 * **A fork parent and child always share an organization.** `assertCanFork`
 * pins the child to the source's org, and `resolveForkEdge` has no org check at
 * all. The move refuses to run while a cross-org edge would result; the fork
 * must be disconnected first.
 *
 * Neither invariant tolerates a transitional or "inert" violation.
 */
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
      | 'source-equals-destination'
      | 'move-operation-parameter-mismatch'
      | 'destination-entitlement-downgrade'
      | 'fork-lineage-conflict'
      | 'pending-invitations-present'
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
  /** Name of the organization that currently owns the workspace, if any. */
  organizationName: string | null
  billedAccountUserId: string
  /** Archived workspaces are movable; surfaced so admin UIs can label them. */
  archived: boolean
  /** Non-null when the workspace cannot be moved, explaining why. */
  ineligibleReason?: string | null
}

/**
 * The organization a workspace is moving out of. Unlike a destination, an
 * ownerless source must not block the move — moving out of it is the fix — so
 * every owner field is nullable.
 */
export interface WorkspaceMoveSourceOrganization {
  id: string
  name: string
  ownerId: string | null
  ownerName: string | null
  ownerEmail: string | null
}

/**
 * Everything the source organization loses or has cleaned up by the move, so an
 * admin can review the damage before confirming.
 */
export interface WorkspaceMoveSourceImpact {
  /**
   * Source-org custom blocks bound to the moving workspace's workflows. These
   * are unpublished by the move — see the cross-org invariant in the module
   * header. Usage is split because the two halves mean different things:
   * placements inside the moving workspace leave with it, while placements
   * elsewhere in the source org are collateral that stays behind and breaks.
   */
  unpublishedCustomBlocks: Array<{
    id: string
    type: string
    name: string
    movingWorkspaceUsage: { live: number; deployed: number }
    sourceOrgElsewhereUsage: { live: number; deployed: number }
  }>
  /** Fork edges crossing the org boundary. Non-empty blocks the move. */
  blockingForkEdges: Array<{
    workspaceId: string
    name: string
    organizationId: string | null
    direction: 'parent' | 'child'
  }>
  detachedPermissionGroups: Array<{ permissionGroupId: string; name: string }>
  strippedRetentionRules: { piiRedactionRules: number; retentionOverrides: number }
  /** Retained collaborators whose source-org per-member cap stops applying. */
  retainedCollaboratorCaps: Array<{
    userId: string
    email: string
    sourceOrgLimitDollars: number | null
  }>
  /** The workspace visibly re-skins when the two orgs' whitelabel settings differ. */
  brandingChanges: boolean
  /** Rows omitted to stay inside the contract's array bounds, or `null`. */
  truncated: {
    customBlocks: number
    permissionGroups: number
    collaboratorCaps: number
    forkEdges: number
    credentials: number
    environmentVariableKeys: number
  } | null
}

/** Workspace secrets that travel with the move. Never carries secret material. */
export interface WorkspaceMoveCredentialSummary {
  items: Array<{
    id: string
    displayName: string
    type: string
    /** Backed by a source-org member's identity, so the destination inherits their access. */
    backedBySourceOrgMember: boolean
  }>
  credentialGroupCount: number
  /** Variable names only — values are never read. */
  environmentVariableKeys: string[]
  byokKeyCount: number
  /** Rows omitted to stay within response limits. */
  truncatedCredentials: number
  truncatedEnvironmentVariableKeys: number
}

export interface WorkspaceMoveEntitlements {
  sourceIsEnterprise: boolean
  destinationIsEnterprise: boolean
  /** Non-empty when the destination cannot carry the source's entitlements. */
  capabilitiesLost: string[]
}

export interface WorkspaceMovePreflight {
  workspace: WorkspaceMoveCandidate
  /** `null` for a personal or grandfathered source. */
  sourceOrganization: WorkspaceMoveSourceOrganization | null
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
    sourceOrganizationMember: boolean
  }>
  invitations: Array<{
    id: string
    email: string
    membershipIntent: 'internal' | 'external'
    permission: 'admin' | 'write' | 'read'
    workspaceGrantCount: number
  }>
  sourceOrganizationImpact: WorkspaceMoveSourceImpact
  credentials: WorkspaceMoveCredentialSummary
  entitlements: WorkspaceMoveEntitlements
  /** Non-empty means the move will throw; the UI must not offer a confirm. */
  blockers: string[]
  /** Advisory consequences the admin should read but which never block. */
  notices: string[]
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
  /** What the source organization lost, for its own audit entry. */
  sourceOrganizationOutcome: {
    sourceOrganizationId: string
    unpublishedCustomBlocks: Array<{ id: string; type: string; name: string }>
    detachedPermissionGroupIds: string[]
  } | null
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
    /**
     * The organization the workspace came from. Persisted because the payer
     * transfer overwrites `workspace.organizationId`, so a reload of a
     * completed operation cannot recover it from the row — and the admin UI
     * reloads exactly that way after a lost response.
     * Optional: operations recorded before this field existed have no value.
     */
    sourceOrganizationId?: string | null
    /**
     * Persisted so the reload path can replay the source organization's loss
     * audit. That write is fire-and-forget after commit, so a crash in between
     * would otherwise leave the organization that lost the workspace with no
     * record and no way to reconstruct one.
     */
    unpublishedCustomBlocks?: Array<{ id: string; type: string; name: string }>
    detachedPermissionGroupIds?: string[]
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
    typeof auditRecord.organizationAssignedAt !== 'string' ||
    (auditRecord.sourceOrganizationId !== undefined &&
      auditRecord.sourceOrganizationId !== null &&
      typeof auditRecord.sourceOrganizationId !== 'string')
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
      /**
       * Deliberately NOT collapsed to `null`. A recorded `null` is an answer —
       * the workspace came from a personal source, so there is no organization
       * to name and nothing was lost. Only an absent key leaves the origin
       * unknown, and merging the two made every reload of a personal-source
       * move report that its source organization had failed to persist.
       */
      sourceOrganizationId: auditRecord.sourceOrganizationId as string | null | undefined,
      unpublishedCustomBlocks:
        (auditRecord.unpublishedCustomBlocks as
          | Array<{ id: string; type: string; name: string }>
          | undefined) ?? [],
      detachedPermissionGroupIds: (auditRecord.detachedPermissionGroupIds as string[]) ?? [],
    },
  }
}

/**
 * Where a completed move came from, rebuilt from its durable payload alone.
 * The payer transfer has already overwritten `workspace.organizationId` by the
 * time any of these paths run, so the payload is the only surviving record.
 *
 * `unknown` is true only when the payload genuinely cannot answer: it predates
 * {@link AdminWorkspaceMoveOperationPayload.audit.sourceOrganizationId}, or it
 * names an organization that has since been deleted. A personal source is a
 * recorded answer, not a gap, and must not be reported as one.
 */
async function resolveRecordedSourceOrganization(
  audit: AdminWorkspaceMoveOperationPayload['audit'] | null,
  executor: DbOrTx
): Promise<{
  id: string | null
  organization: WorkspaceMoveSourceOrganization | null
  /** False only for a payload written before the field existed. */
  recorded: boolean
  unknown: boolean
}> {
  const recorded = audit ? audit.sourceOrganizationId !== undefined : false
  const id = audit?.sourceOrganizationId ?? null
  const organization = id ? await getSourceOrganization(id, executor) : null
  return {
    id,
    organization,
    recorded,
    unknown: !recorded || (id !== null && organization === null),
  }
}

/**
 * The truncation record for an applied summary, merging what the move's own
 * lists dropped with what the credential summary dropped — the same merge
 * preflight performs, so a partial applied review is never presented as a
 * complete one.
 */
function buildAppliedTruncation(params: {
  unpublishedCustomBlocks: number
  detachedPermissionGroups: number
  credentials: WorkspaceMoveCredentialSummary
}): WorkspaceMoveSourceImpact['truncated'] {
  const truncated = {
    customBlocks: Math.max(params.unpublishedCustomBlocks - PREFLIGHT_LIST_LIMITS.customBlocks, 0),
    permissionGroups: Math.max(
      params.detachedPermissionGroups - PREFLIGHT_LIST_LIMITS.permissionGroups,
      0
    ),
    collaboratorCaps: 0,
    forkEdges: 0,
    credentials: params.credentials.truncatedCredentials,
    environmentVariableKeys: params.credentials.truncatedEnvironmentVariableKeys,
  }
  return Object.values(truncated).some((dropped) => dropped > 0) ? truncated : null
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

/**
 * The workspace changed organizations between the optimistic pre-transaction
 * read and the locked read, so the wrong organization was locked. Handled by
 * the same retry loop as {@link InvitationSetChangedError}.
 */
class SourceOrganizationChangedError extends Error {
  constructor(readonly organizationId: string | null) {
    super('Workspace organization changed while acquiring workspace move locks')
    this.name = 'SourceOrganizationChangedError'
  }
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

/**
 * Returns movable workspaces by case-insensitive name or exact UUID, including
 * organization-owned ones. `organizationName` is joined so an admin can see
 * which organization a candidate would be taken *from* before selecting it.
 */
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
      organizationName: organization.name,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .leftJoin(organization, eq(organization.id, workspace.organizationId))
    .where(and(or(eq(workspace.id, query), ilike(workspace.name, `%${query}%`)), undefined))
    .orderBy(asc(workspace.name))
    .limit(Math.min(Math.max(limit, 1), 50))
    .offset(Math.max(offset, 0))

  const boundedLimit = Math.min(Math.max(limit, 1), 50)
  const total = rows[0]?.total ?? 0
  return {
    /**
     * Ineligible rows are returned, not hidden. A support admin searching for a
     * workspace by name needs to learn that it exists and why it cannot move —
     * an empty result is indistinguishable from "no such workspace" and leaves
     * them with no next step.
     */
    data: rows.map(({ archivedAt, total: _total, ...row }) => ({
      ...row,
      archived: archivedAt !== null,
      ineligibleReason: describeWorkspaceMoveIneligibility(row),
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

  const sourceOrganizationId = workspaceRow.organizationId
  if (sourceOrganizationId === destinationOrganizationId) {
    throw new WorkspaceMoveError(
      'Workspace already belongs to this organization',
      'source-equals-destination'
    )
  }

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
        sourceMemberId: sourceMember.id,
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
      .leftJoin(
        sourceMember,
        and(
          eq(sourceMember.userId, permissions.userId),
          sourceOrganizationId ? eq(sourceMember.organizationId, sourceOrganizationId) : sql`false`
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

  const [sourceOrganization, entitlements, credentials, forkEdges, sourceImpact] =
    await Promise.all([
      sourceOrganizationId ? getSourceOrganization(sourceOrganizationId) : null,
      resolveMoveEntitlements(sourceOrganizationId, destinationOrganizationId),
      collectWorkspaceCredentialSummary(workspaceId, sourceOrganizationId),
      findCrossOrgForkEdges(workspaceId, destinationOrganizationId),
      collectSourceOrganizationImpact(workspaceId, sourceOrganizationId, destinationOrganizationId),
    ])

  const boundedForkEdges = boundList(forkEdges, PREFLIGHT_LIST_LIMITS.forkEdges)
  /**
   * One truncation record covering every bounded list, so a partial review is
   * never presented as a complete one.
   */
  const droppedTotal =
    (sourceImpact.truncated?.customBlocks ?? 0) +
    (sourceImpact.truncated?.permissionGroups ?? 0) +
    (sourceImpact.truncated?.collaboratorCaps ?? 0) +
    boundedForkEdges.dropped +
    credentials.truncatedCredentials +
    credentials.truncatedEnvironmentVariableKeys
  const mergedTruncation =
    droppedTotal > 0
      ? {
          customBlocks: sourceImpact.truncated?.customBlocks ?? 0,
          permissionGroups: sourceImpact.truncated?.permissionGroups ?? 0,
          collaboratorCaps: sourceImpact.truncated?.collaboratorCaps ?? 0,
          forkEdges: boundedForkEdges.dropped,
          credentials: credentials.truncatedCredentials,
          environmentVariableKeys: credentials.truncatedEnvironmentVariableKeys,
        }
      : null

  const blockers = buildMoveBlockers({
    entitlements,
    forkEdges,
    pendingInvitationCount: sourceOrganizationId ? invitationRows.length : 0,
    /**
     * Seat capacity throws `seat-capacity-exceeded` in the transaction, so it
     * belongs in `blockers` too. Leaving it only in `warning` let a client
     * keying on the new field offer a confirmation guaranteed to fail.
     */
    seatCapacityWarning: warning,
  })

  return {
    workspace: workspaceRow,
    sourceOrganization,
    destinationOrganization: destination,
    collaborators: collaboratorRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      permission: row.permission,
      organizationMember: row.memberId !== null,
      sourceOrganizationMember: row.sourceMemberId !== null,
    })),
    invitations: invitationRows.map(({ organizationId: _organizationId, ...row }) => row),
    sourceOrganizationImpact: {
      ...sourceImpact,
      blockingForkEdges: boundedForkEdges.items,
      truncated: mergedTruncation,
    },
    credentials,
    entitlements,
    blockers,
    notices: buildMoveNotices({
      sourceOrganization,
      destinationOrganization: destination,
      sourceImpact: { ...sourceImpact, truncated: mergedTruncation },
      credentials,
    }),
    warning,
  }
}

/**
 * The conditions that make a move refuse outright, in the order an admin should
 * resolve them. Each is re-checked inside the move transaction — this list is
 * for presentation, never for authorization.
 */
function buildMoveBlockers(params: {
  entitlements: WorkspaceMoveEntitlements
  forkEdges: CrossOrgForkEdge[]
  pendingInvitationCount: number
  seatCapacityWarning: string | null
}): string[] {
  const blockers: string[] = []
  if (params.seatCapacityWarning) {
    blockers.push(params.seatCapacityWarning)
  }
  if (params.entitlements.capabilitiesLost.length > 0) {
    blockers.push(
      `The destination organization is not on Enterprise, so this workspace would lose ${formatList(params.entitlements.capabilitiesLost)}. Upgrade the destination or choose another organization.`
    )
  }
  if (params.forkEdges.length > 0) {
    blockers.push(
      `${params.forkEdges.length} fork ${params.forkEdges.length === 1 ? 'edge' : 'edges'} would span two organizations. Disconnect ${params.forkEdges.length === 1 ? 'it' : 'them'} from workspace settings before moving.`
    )
  }
  if (params.pendingInvitationCount > 0) {
    blockers.push(
      `${params.pendingInvitationCount} pending invitation${params.pendingInvitationCount === 1 ? '' : 's'} would be re-targeted at another organization. Let ${params.pendingInvitationCount === 1 ? 'it' : 'them'} be accepted or cancel ${params.pendingInvitationCount === 1 ? 'it' : 'them'} first.`
    )
  }
  return blockers
}

/** Advisory consequences worth reading before confirming, but never blocking. */
function buildMoveNotices(params: {
  sourceOrganization: WorkspaceMoveSourceOrganization | null
  destinationOrganization: WorkspaceMoveDestination
  sourceImpact: Omit<WorkspaceMoveSourceImpact, 'blockingForkEdges'>
  credentials: WorkspaceMoveCredentialSummary
}): string[] {
  const notices: string[] = []
  /**
   * Truncation is reported before the source-organization early return: fork
   * edges and credentials can be truncated on a personal source too, and a
   * partial review must never present as a complete one.
   */
  if (params.sourceImpact.truncated) {
    const t = params.sourceImpact.truncated
    notices.push(
      `This review is incomplete — some lists were truncated to stay within response limits: ${t.customBlocks} custom block(s), ${t.permissionGroups} permission group(s), ${t.collaboratorCaps} collaborator cap(s), ${t.forkEdges} fork edge(s), ${t.credentials} credential(s) and ${t.environmentVariableKeys} environment variable(s) not shown.`
    )
  }
  if (!params.sourceOrganization) return notices

  notices.push(
    `${params.destinationOrganization.name} gains this workspace's entire audit history, and ${params.sourceOrganization.name} loses visibility of it. Organization-scoped data drains follow the same boundary.`
  )
  if (params.sourceImpact.unpublishedCustomBlocks.length > 0) {
    const strandedDeployments = params.sourceImpact.unpublishedCustomBlocks.reduce(
      (total, block) => total + block.sourceOrgElsewhereUsage.deployed,
      0
    )
    notices.push(
      `${params.sourceImpact.unpublishedCustomBlocks.length} custom block${params.sourceImpact.unpublishedCustomBlocks.length === 1 ? '' : 's'} will be unpublished from ${params.sourceOrganization.name}${strandedDeployments > 0 ? `, breaking ${strandedDeployments} deployed workflow${strandedDeployments === 1 ? '' : 's'} that stay behind` : ''}.`
    )
  }
  const sourceBackedCredentials = params.credentials.items.filter(
    (item) => item.backedBySourceOrgMember
  ).length
  if (sourceBackedCredentials > 0) {
    notices.push(
      `${sourceBackedCredentials} credential${sourceBackedCredentials === 1 ? '' : 's'} are backed by a ${params.sourceOrganization.name} member's identity, so ${params.destinationOrganization.name} inherits the ability to act as them.`
    )
  }
  const cappedCollaborators = params.sourceImpact.retainedCollaboratorCaps.filter(
    (collaborator) => collaborator.sourceOrgLimitDollars !== null
  ).length
  if (cappedCollaborators > 0) {
    notices.push(
      `${cappedCollaborators} retained collaborator${cappedCollaborators === 1 ? '' : 's'} had a per-member usage cap in ${params.sourceOrganization.name} that will no longer apply. Re-apply it in ${params.destinationOrganization.name} if it should continue.`
    )
  }
  if (params.sourceImpact.brandingChanges) {
    notices.push(
      `The workspace will re-skin to ${params.destinationOrganization.name}'s branding immediately.`
    )
  }
  return notices
}

/**
 * Ceilings that keep a preflight response inside its contract's array bounds.
 * A workspace with more rows than these is pathological, but silently emitting
 * an oversized list makes `requestJson` reject the whole response on the
 * client — the review surface would go blank rather than degrade. Truncate and
 * say so instead; never drop rows without a notice.
 */
const PREFLIGHT_LIST_LIMITS = {
  forkEdges: 500,
  customBlocks: 500,
  permissionGroups: 500,
  collaboratorCaps: 1_000,
  credentials: 1_000,
  environmentVariableKeys: 1_000,
} as const

/** Truncates to `limit`, returning what was dropped so callers can disclose it. */
function boundList<T>(items: T[], limit: number): { items: T[]; dropped: number } {
  return items.length <= limit
    ? { items, dropped: 0 }
    : { items: items.slice(0, limit), dropped: items.length - limit }
}

/** Renders a list as `a, b and c` for human-facing blocker copy. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Gathers everything the source organization loses, excluding fork edges, which
 * the caller resolves separately because they also drive a blocker.
 */
async function collectSourceOrganizationImpact(
  workspaceId: string,
  sourceOrganizationId: string | null,
  destinationOrganizationId: string
): Promise<Omit<WorkspaceMoveSourceImpact, 'blockingForkEdges'>> {
  if (!sourceOrganizationId) {
    return {
      unpublishedCustomBlocks: [],
      detachedPermissionGroups: [],
      strippedRetentionRules: { piiRedactionRules: 0, retentionOverrides: 0 },
      retainedCollaboratorCaps: [],
      brandingChanges: false,
      truncated: null,
    }
  }

  const [customBlocks, permissionGroups, retentionSettings, collaboratorCaps, brandingChanges] =
    await Promise.all([
      findUnpublishableCustomBlocks(workspaceId, sourceOrganizationId),
      findAttachedPermissionGroups(workspaceId),
      db
        .select({ dataRetentionSettings: organization.dataRetentionSettings })
        .from(organization)
        .where(eq(organization.id, sourceOrganizationId))
        .limit(1),
      findRetainedCollaboratorCaps(workspaceId, sourceOrganizationId),
      willBrandingChange(sourceOrganizationId, destinationOrganizationId),
    ])

  const boundedBlocks = boundList(customBlocks.items, PREFLIGHT_LIST_LIMITS.customBlocks)
  /** Enrichment already capped the slice, so the gap comes from the true total. */
  const droppedBlocks = Math.max(customBlocks.total - boundedBlocks.items.length, 0)
  const boundedGroups = boundList(permissionGroups, PREFLIGHT_LIST_LIMITS.permissionGroups)
  const boundedCaps = boundList(collaboratorCaps, PREFLIGHT_LIST_LIMITS.collaboratorCaps)

  return {
    unpublishedCustomBlocks: boundedBlocks.items,
    detachedPermissionGroups: boundedGroups.items,
    strippedRetentionRules: countRetentionRulesForWorkspace(
      retentionSettings[0]?.dataRetentionSettings,
      workspaceId
    ),
    retainedCollaboratorCaps: boundedCaps.items,
    brandingChanges,
    truncated:
      droppedBlocks + boundedGroups.dropped + boundedCaps.dropped > 0
        ? {
            customBlocks: droppedBlocks,
            permissionGroups: boundedGroups.dropped,
            collaboratorCaps: boundedCaps.dropped,
            forkEdges: 0,
            credentials: 0,
            environmentVariableKeys: 0,
          }
        : null,
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
  /**
   * The source organization must be locked alongside the destination, but its
   * id is only knowable by reading the workspace — which happens *after* the
   * locks. Read it optimistically here, then re-verify under the locks and
   * retry through the existing loop when it moved underneath us.
   */
  let candidateSourceOrganizationId = await readWorkspaceOrganizationId(params.workspaceId)
  /**
   * Resolved outside the transaction on purpose — see the entitlement check
   * inside it for why. Recomputed per attempt so a retry after a source-org
   * change re-evaluates against the organization actually being left.
   */
  let entitlements = await resolveMoveEntitlements(
    candidateSourceOrganizationId,
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
        /**
         * Both organizations are mutated, so both are locked — ascending by id,
         * mirroring `acquireOrganizationUserMutationLocks`, so two concurrent
         * moves swapping a workspace between the same pair cannot deadlock.
         */
        for (const organizationId of [
          ...new Set(
            [candidateSourceOrganizationId, params.destinationOrganizationId].filter(
              (id): id is string => id !== null
            )
          ),
        ].sort()) {
          await acquireOrganizationMutationLock(tx, organizationId)
        }

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
        if (workspaceRow.organizationId !== candidateSourceOrganizationId) {
          throw new SourceOrganizationChangedError(workspaceRow.organizationId)
        }
        const sourceOrganizationId = workspaceRow.organizationId
        /** Set by the in-transaction fence; the summary reports this, not the optimistic read. */
        let fencedEntitlements: WorkspaceMoveEntitlements | undefined
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
          const recordedAudit = existingDurableOperation
            ? (parseAdminWorkspaceMoveOperationPayload(existingDurableOperation.payload)?.audit ??
              null)
            : null
          /**
           * A retry of a confirmed operation must return what the original move
           * did, not a blank. The durable payload persists the source
           * organization and its losses precisely so this branch can rebuild
           * them — discarding it here made the retry claim the source was
           * unrecoverable while the payload was sitting right there.
           */
          const recordedSource = await resolveRecordedSourceOrganization(recordedAudit, tx)
          /**
           * The workspace's own secrets are untouched by a move and by this
           * no-op retry, so they are read rather than blanked: a retry that
           * reported zero credentials told the admin the workspace had none.
           */
          const replayedCredentials = await collectWorkspaceCredentialSummary(
            params.workspaceId,
            recordedSource.id,
            tx
          )
          return {
            performedMove: false,
            sourceOrganizationOutcome: recordedSource.id
              ? {
                  sourceOrganizationId: recordedSource.id,
                  unpublishedCustomBlocks: recordedAudit?.unpublishedCustomBlocks ?? [],
                  detachedPermissionGroupIds: recordedAudit?.detachedPermissionGroupIds ?? [],
                }
              : null,
            previousBillingOwnerId: workspaceRow.billedAccountUserId,
            destinationOwnerId: destination.ownerId,
            organizationAssignedAt: null,
            durableAudit: recordedAudit,
            invitationEvents: [],
            summary: await getMovedWorkspaceSummary(tx, params.workspaceId, destination, {
              sourceOrganization: recordedSource.organization,
              sourceOrganizationImpact: {
                ...EMPTY_SOURCE_IMPACT,
                truncated: buildAppliedTruncation({
                  unpublishedCustomBlocks: 0,
                  detachedPermissionGroups: 0,
                  credentials: replayedCredentials,
                }),
              },
              credentials: replayedCredentials,
              entitlements: {
                sourceIsEnterprise: false,
                destinationIsEnterprise: false,
                capabilitiesLost: [],
              },
              notices: recordedSource.unknown
                ? [
                    'This workspace was already in the destination organization, so the organization it originally came from is no longer recoverable.',
                  ]
                : [],
            }),
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

        /**
         * The three org-to-org blockers, re-checked under the locks. Preflight
         * evaluated them too, but a subscription can lapse, a fork can be
         * created, and an invitation can arrive in between — and each of these
         * either violates a cross-org invariant or silently rewrites a promise
         * the source organization made.
         */
        /**
         * The fork check is NOT gated on an organization source. A personal
         * workspace whose parent has since moved into an organization still
         * produces a cross-organization edge when it lands in a different one,
         * and the invariant admits no exceptions. Preflight already reports it
         * unconditionally; gating it here would let the transaction accept a
         * move preflight had refused.
         */
        const forkEdges = await findCrossOrgForkEdges(
          params.workspaceId,
          params.destinationOrganizationId,
          tx
        )
        if (forkEdges.length > 0) {
          throw new WorkspaceMoveError(
            `${forkEdges.length} fork ${forkEdges.length === 1 ? 'edge' : 'edges'} would span two organizations. Disconnect the fork before moving this workspace.`,
            'fork-lineage-conflict'
          )
        }

        /**
         * An organization source requires a durable operation, and that is a
         * caller contract rather than an operator-facing outcome.
         *
         * The source organization's "workspace moved out" audit is written
         * after commit, so a process that dies in between loses it. Every
         * other post-commit record recovers on retry, but this one cannot:
         * the workspace has already left, so its source organization is no
         * longer readable from the row. The durable payload is the only place
         * that id survives, and the `already-moved` branch above replays the
         * audit from it.
         *
         * Refusing here instead of reconstructing later is what keeps that a
         * closed question. The two non-durable callers, the member transfer
         * operation and Enterprise provisioning, both select through
         * `ownedAttachableWorkspacesWhere`, which requires a null
         * `organizationId`, so neither can reach this. The admin route always
         * supplies one, because `operationId` is required by
         * `adminDashboardWorkspaceMoveBodySchema`. This throws a plain Error
         * on purpose: it is unreachable by construction today, and a future
         * caller that reaches it has a wiring bug, not a bad request.
         */
        if (sourceOrganizationId && !params.durableOperationId) {
          throw new Error(
            `Refusing to move workspace ${params.workspaceId} out of organization ${sourceOrganizationId} without a durable operation id: the source organization audit would not survive a crash before it is written.`
          )
        }

        if (sourceOrganizationId) {
          /**
           * Entitlements are resolved BEFORE the transaction, not here.
           * `isOrganizationOnEnterprisePlan` reads through the global client
           * with no executor seam, so calling it inside the transaction trips
           * the transaction tripwire outside production and reserves a second
           * pool connection in it. The check is a precondition, not an
           * invariant: a plan lapsing in the seconds between the read and the
           * commit lands the workspace in an organization that just lost its
           * entitlements, which is recoverable by moving it back — unlike a
           * cross-organization artifact, which is not.
           */
          /**
           * Evaluate BOTH organizations under the locks when entitlement is
           * subscription-backed, rather than trusting the pre-transaction
           * verdict. That verdict is still what preflight reports, but as a
           * blocker it is stale in both directions: a destination that lapsed
           * after it was read, and a source that GAINED entitlement after it
           * was read, which would otherwise skip the fence entirely.
           *
           * `isSubscriptionBackedEntitlement` is exported from the same module
           * as `resolveOrganizationEnterprisePlan`'s short-circuits, so the two
           * modes where entitlement is granted by deployment configuration —
           * and no `subscription` row need exist — cannot drift away from this.
           */
          /**
           * Re-run the SAME resolver under the locks, on `tx`. The
           * pre-transaction verdict is stale in both directions — a destination
           * that lapsed after it was read, and a source that gained Enterprise
           * after it was read, which would otherwise skip the check entirely.
           * Reusing `resolveMoveEntitlements` rather than re-deriving the
           * predicate here is what keeps the fence and preflight from ever
           * disagreeing about what counts as a downgrade.
           */
          fencedEntitlements = await resolveMoveEntitlements(
            sourceOrganizationId,
            params.destinationOrganizationId,
            tx
          )
          if (fencedEntitlements.capabilitiesLost.length > 0) {
            throw new WorkspaceMoveError(
              `The destination organization is not on Enterprise, so this workspace would lose ${fencedEntitlements.capabilitiesLost.join(', ')}`,
              'destination-entitlement-downgrade'
            )
          }

          const pendingInvitations = await getPendingInvitationSummaries(params.workspaceId, tx)
          if (pendingInvitations.length > 0) {
            throw new WorkspaceMoveError(
              `This workspace has ${pendingInvitations.length} pending invitation${pendingInvitations.length === 1 ? '' : 's'} scoped to its current organization. Let them be accepted or cancel them before moving it.`,
              'pending-invitations-present'
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

        /**
         * Enforce the cross-org invariants before the payer moves, while the
         * source organization is still the one on the row. Unpublishing a
         * custom block is the product's own `deleteCustomBlock`; the usage
         * counts are captured first so the source org's audit entry can say how
         * much it cost.
         */
        const sourceOrganization = sourceOrganizationId
          ? await getSourceOrganization(sourceOrganizationId, tx)
          : null
        const unpublishedCustomBlocks = sourceOrganizationId
          ? await findSourceOrgCustomBlocksForWorkspace(
              params.workspaceId,
              sourceOrganizationId,
              tx
            )
          : []
        for (const block of unpublishedCustomBlocks) {
          await deleteCustomBlock(block.id, tx)
        }
        const cleanup = sourceOrganizationId
          ? await cleanupSourceOrganizationArtifactsTx(tx, {
              workspaceId: params.workspaceId,
              sourceOrganizationId,
            })
          : { detachedPermissionGroupIds: [] }

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
                sourceOrganizationId,
                unpublishedCustomBlocks,
                detachedPermissionGroupIds: cleanup.detachedPermissionGroupIds,
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

        /**
         * Read against the PRE-move source organization, which is what
         * `backedBySourceOrgMember` means. Every row this counts is workspace-
         * scoped and travels with the move untouched, so unlike the source
         * impact it is still fully reportable here — blanking it told the admin
         * who just confirmed the move that the workspace carried no secrets.
         */
        const movedCredentials = await collectWorkspaceCredentialSummary(
          params.workspaceId,
          sourceOrganizationId,
          tx
        )

        return {
          performedMove: true,
          previousBillingOwnerId: workspaceRow.billedAccountUserId,
          destinationOwnerId: destination.ownerId,
          organizationAssignedAt: now,
          durableAudit,
          invitationEvents: migration.invitationEvents,
          sourceOrganizationOutcome: sourceOrganizationId
            ? {
                sourceOrganizationId,
                unpublishedCustomBlocks: unpublishedCustomBlocks.map(({ id, type, name }) => ({
                  id,
                  type,
                  name,
                })),
                detachedPermissionGroupIds: cleanup.detachedPermissionGroupIds,
              }
            : null,
          summary: await getMovedWorkspaceSummary(tx, params.workspaceId, destination, {
            sourceOrganization,
            /**
             * What the move actually did, not what preflight projected. The
             * rest of the impact described the pre-move state and is not
             * recoverable — or meaningful — once the workspace has landed.
             */
            sourceOrganizationImpact: {
              ...EMPTY_SOURCE_IMPACT,
              /**
               * Usage counts are zero here rather than measured: they describe
               * how much breaks in the source organization, and the reads that
               * produce them are not transaction-safe. Preflight carries the
               * real numbers; this reports which blocks were unpublished.
               */
              unpublishedCustomBlocks: boundList(
                unpublishedCustomBlocks,
                PREFLIGHT_LIST_LIMITS.customBlocks
              ).items.map((block) => ({
                ...block,
                movingWorkspaceUsage: { live: 0, deployed: 0 },
                sourceOrgElsewhereUsage: { live: 0, deployed: 0 },
              })),
              detachedPermissionGroups: boundList(
                cleanup.detachedPermissionGroupIds,
                PREFLIGHT_LIST_LIMITS.permissionGroups
              ).items.map((permissionGroupId) => ({ permissionGroupId, name: '' })),
              /** The applied response is bounded by the same limits as preflight. */
              truncated: buildAppliedTruncation({
                unpublishedCustomBlocks: unpublishedCustomBlocks.length,
                detachedPermissionGroups: cleanup.detachedPermissionGroupIds.length,
                credentials: movedCredentials,
              }),
            },
            credentials: movedCredentials,
            /**
             * The fenced result, not the optimistic one: the response must
             * describe the entitlement state the move was actually allowed
             * against, or a destination that gained Enterprise between the two
             * reads is reported as a downgrade it no longer is.
             */
            entitlements: fencedEntitlements ?? entitlements,
            notices: [],
          }),
        } satisfies MoveTransactionResult
      })
      break
    } catch (error) {
      if (error instanceof InvitationSetChangedError) {
        candidateInvitationIds = error.invitationIds
        continue
      }
      if (error instanceof SourceOrganizationChangedError) {
        candidateSourceOrganizationId = error.organizationId
        entitlements = await resolveMoveEntitlements(
          candidateSourceOrganizationId,
          params.destinationOrganizationId
        )
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
    /**
     * Replay the source organization's loss audit on this path too. The write
     * is fire-and-forget after commit, so the retry that reaches this branch is
     * often the one recovering from a process that died before it landed.
     * `recordAuditOnce` keys make it a no-op when it already did.
     */
    if (result.sourceOrganizationOutcome) {
      await recordSourceOrganizationMoveAudit({
        workspaceId: params.workspaceId,
        sourceOrganizationId: result.sourceOrganizationOutcome.sourceOrganizationId,
        destinationOrganizationId: params.destinationOrganizationId,
        adminEmail: params.adminEmail,
        auditActor: params.auditActor,
        auditOperationId: params.auditOperationId,
        unpublishedCustomBlocks: result.sourceOrganizationOutcome.unpublishedCustomBlocks,
        detachedPermissionGroupIds: result.sourceOrganizationOutcome.detachedPermissionGroupIds,
      })
    }
    logger.info('Workspace was already in destination organization', {
      workspaceId: params.workspaceId,
      destinationOrganizationId: params.destinationOrganizationId,
    })
    return result.summary
  }

  invalidateWorkspaceTableLimitsCache(params.workspaceId)

  if (result.sourceOrganizationOutcome) {
    await recordSourceOrganizationMoveAudit({
      workspaceId: params.workspaceId,
      sourceOrganizationId: result.sourceOrganizationOutcome.sourceOrganizationId,
      destinationOrganizationId: params.destinationOrganizationId,
      adminEmail: params.adminEmail,
      auditActor: params.auditActor,
      auditOperationId: params.auditOperationId,
      unpublishedCustomBlocks: result.sourceOrganizationOutcome.unpublishedCustomBlocks,
      detachedPermissionGroupIds: result.sourceOrganizationOutcome.detachedPermissionGroupIds,
    })
  }

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

/**
 * Records what the source organization lost, in the source organization's own
 * audit view.
 *
 * The workspace-scoped move entry above is visible only to the *destination*
 * after the move — `buildOrgScopeCondition` scopes org audit reads by the
 * organization's current workspaces — so without this the organization that
 * lost the workspace has no record of it at all. `workspaceId: null` plus
 * `metadata.organizationId` is that condition's org-level branch, which
 * resolves to the source and nowhere else.
 */
async function recordSourceOrganizationMoveAudit(params: {
  workspaceId: string
  sourceOrganizationId: string
  destinationOrganizationId: string
  adminEmail: string
  auditActor?: { id: string | null; name: string; email: string | null }
  auditOperationId?: string
  unpublishedCustomBlocks: Array<{ id: string; type: string; name: string }>
  detachedPermissionGroupIds: string[]
}): Promise<void> {
  const actor = {
    actorId: params.auditActor ? params.auditActor.id : null,
    actorName: params.auditActor?.name ?? 'Admin Panel',
    actorEmail: params.auditActor?.email ?? params.adminEmail,
  }

  const moveOut = {
    workspaceId: null,
    ...actor,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: params.sourceOrganizationId,
    description: 'Workspace moved out of this organization',
    metadata: {
      organizationId: params.sourceOrganizationId,
      workspaceId: params.workspaceId,
      destinationOrganizationId: params.destinationOrganizationId,
      unpublishedCustomBlockIds: params.unpublishedCustomBlocks.map((block) => block.id),
      detachedPermissionGroupIds: params.detachedPermissionGroupIds,
    },
  } as const

  if (params.auditOperationId) {
    await recordAuditOnce(
      `${params.auditOperationId}:workspace-move-source:${params.workspaceId}`,
      moveOut
    )
  } else {
    recordAudit(moveOut)
  }

  for (const block of params.unpublishedCustomBlocks) {
    const unpublished = {
      workspaceId: null,
      ...actor,
      action: AuditAction.CUSTOM_BLOCK_DELETED,
      resourceType: AuditResourceType.CUSTOM_BLOCK,
      resourceId: block.id,
      resourceName: block.name,
      description: `Unpublished custom block "${block.name}"`,
      metadata: {
        organizationId: params.sourceOrganizationId,
        type: block.type,
        reason: 'workspace-moved-to-another-organization',
        workspaceId: params.workspaceId,
        destinationOrganizationId: params.destinationOrganizationId,
      },
    } as const
    if (params.auditOperationId) {
      await recordAuditOnce(
        `${params.auditOperationId}:custom-block-unpublished:${block.id}`,
        unpublished
      )
    } else {
      recordAudit(unpublished)
    }
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
  /**
   * Reconstruct the source organization from the durable payload. The payer
   * transfer already overwrote `workspace.organizationId`, so the row cannot
   * supply it — and this reload is the path the admin UI takes after a lost
   * response, which is exactly when the operator most needs to see what the
   * move did and where it came from.
   */
  const recordedSource = await resolveRecordedSourceOrganization(operationPayload.audit, db)

  /**
   * Replay the source organization's loss audit. `recordAuditOnce` keys make it
   * idempotent, so this is a no-op when the original write landed and a repair
   * when the process died between commit and that fire-and-forget write.
   */
  if (recordedSource.id) {
    await recordSourceOrganizationMoveAudit({
      workspaceId,
      sourceOrganizationId: recordedSource.id,
      destinationOrganizationId,
      adminEmail: operationPayload.audit.actor.email ?? 'admin-api@sim.ai',
      auditActor: operationPayload.audit.actor,
      auditOperationId: operationId,
      unpublishedCustomBlocks: operationPayload.audit.unpublishedCustomBlocks ?? [],
      detachedPermissionGroupIds: operationPayload.audit.detachedPermissionGroupIds ?? [],
    })
  }

  /**
   * The workspace's secrets are workspace-scoped and travel with the move, so
   * the reload reads them rather than reporting a blank. `backedBySourceOrgMember`
   * resolves against the recorded source; a personal or unrecorded source has no
   * members to match, which is exactly what a `null` id asks for.
   */
  const credentials = await collectWorkspaceCredentialSummary(workspaceId, recordedSource.id)

  return toWorkspaceMoveOperationView(
    await getMovedWorkspaceSummary(db, workspaceId, destination, {
      sourceOrganization: recordedSource.organization,
      sourceOrganizationImpact: {
        ...EMPTY_SOURCE_IMPACT,
        truncated: buildAppliedTruncation({
          unpublishedCustomBlocks: 0,
          detachedPermissionGroups: 0,
          credentials,
        }),
      },
      credentials,
      entitlements: {
        sourceIsEnterprise: false,
        destinationIsEnterprise: false,
        capabilitiesLost: [],
      },
      /**
       * A recorded `null` means the workspace came from a personal source and
       * there is nothing to name — not that the record is defective.
       */
      notices: recordedSource.unknown
        ? [
            recordedSource.recorded
              ? 'The organization this workspace came from has since been deleted, so it can no longer be named.'
              : 'This move was recorded before the source organization was persisted, so it cannot be reported.',
          ]
        : [],
    }),
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
      organizationName: organization.name,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .leftJoin(organization, eq(organization.id, workspace.organizationId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }))
}

/**
 * Archived workspaces are deliberately movable: leaving them behind keeps an
 * unarchive-later escape hatch outside the organization's purview, and
 * join-attach already sweeps them (`includeArchived`).
 *
 * Organization-owned workspaces are movable too — that is this feature. What
 * remains rejected is *drift*: `workspaceMode` disagreeing with whether an
 * organization is actually assigned. `getWorkspaceCreationPolicy` only ever
 * pairs `PERSONAL` with a null organization, so either mismatch means the row
 * is corrupt and its true payer is unknowable. Moving it would hand
 * `changeWorkspaceStoragePayerInTx` an `expectedCurrentPayer` that cannot be
 * trusted, so it must be repaired before it can be moved.
 */
export function describeWorkspaceMoveIneligibility(row: {
  workspaceMode: string
  organizationId?: string | null
}): string | null {
  const isOrganizationMode = row.workspaceMode === WORKSPACE_MODE.ORGANIZATION
  const hasOrganization = row.organizationId !== undefined && row.organizationId !== null
  if (isOrganizationMode === hasOrganization) return null
  return isOrganizationMode
    ? 'In organization mode but no organization is assigned. Repair the row before moving it.'
    : 'Has an organization assigned but is not in organization mode. Repair the row before moving it.'
}

function assertWorkspaceMovable(row: {
  archivedAt?: Date | null
  workspaceMode: string
  organizationId?: string | null
}): void {
  const reason = describeWorkspaceMoveIneligibility(row)
  if (reason) {
    throw new WorkspaceMoveError(reason, 'already-organization-workspace')
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
          ...incomingInternalEmails.map((email) =>
            eq(foldedEmail(user.email), normalizeEmail(email))
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

/**
 * Source-org context captured BEFORE the payer transfer rewrites
 * `workspace.organizationId`. Without it the post-move summary cannot name the
 * organization the workspace came from, because the row no longer records it.
 */
interface AppliedMoveContext {
  sourceOrganization: WorkspaceMoveSourceOrganization | null
  sourceOrganizationImpact: WorkspaceMoveSourceImpact
  credentials: WorkspaceMoveCredentialSummary
  entitlements: WorkspaceMoveEntitlements
  notices: string[]
}

async function getMovedWorkspaceSummary(
  executor: DbOrTx,
  workspaceId: string,
  destination: WorkspaceMoveDestination,
  appliedContext?: AppliedMoveContext
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
      organizationName: organization.name,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .innerJoin(user, eq(user.id, workspace.ownerId))
    .leftJoin(organization, eq(organization.id, workspace.organizationId))
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
      sourceMemberId: sourceMember.id,
    })
    .from(permissions)
    .innerJoin(user, eq(user.id, permissions.userId))
    .leftJoin(
      member,
      and(eq(member.userId, permissions.userId), eq(member.organizationId, destination.id))
    )
    .leftJoin(
      sourceMember,
      and(
        eq(sourceMember.userId, permissions.userId),
        appliedContext?.sourceOrganization
          ? eq(sourceMember.organizationId, appliedContext.sourceOrganization.id)
          : sql`false`
      )
    )
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

  return {
    workspace: workspaceRow,
    sourceOrganization: appliedContext?.sourceOrganization ?? null,
    destinationOrganization: destination,
    collaborators: collaboratorRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      permission: row.permission,
      organizationMember: row.memberId !== null,
      sourceOrganizationMember: row.sourceMemberId !== null,
    })),
    invitations: (await getPendingInvitationSummaries(workspaceId, executor)).map(
      ({ organizationId: _organizationId, ...row }) => row
    ),
    sourceOrganizationImpact: appliedContext?.sourceOrganizationImpact ?? EMPTY_SOURCE_IMPACT,
    credentials: appliedContext?.credentials ?? EMPTY_CREDENTIAL_SUMMARY,
    entitlements: appliedContext?.entitlements ?? {
      sourceIsEnterprise: false,
      destinationIsEnterprise: false,
      capabilitiesLost: [],
    },
    blockers: [],
    notices: appliedContext?.notices ?? [],
    warning: null,
  }
}

/** A move that is already applied has no source-org context to report. */
const EMPTY_SOURCE_IMPACT: WorkspaceMoveSourceImpact = {
  unpublishedCustomBlocks: [],
  blockingForkEdges: [],
  detachedPermissionGroups: [],
  strippedRetentionRules: { piiRedactionRules: 0, retentionOverrides: 0 },
  retainedCollaboratorCaps: [],
  brandingChanges: false,
  truncated: null,
}

const EMPTY_CREDENTIAL_SUMMARY: WorkspaceMoveCredentialSummary = {
  items: [],
  credentialGroupCount: 0,
  environmentVariableKeys: [],
  byokKeyCount: 0,
  truncatedCredentials: 0,
  truncatedEnvironmentVariableKeys: 0,
}

/**
 * The workspace's current organization, read outside the move transaction so
 * both organizations can be locked in a deterministic order. Always re-verified
 * under the locks — see {@link SourceOrganizationChangedError}.
 */
async function readWorkspaceOrganizationId(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row?.organizationId ?? null
}
