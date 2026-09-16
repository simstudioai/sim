import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissions, user, workspace, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole, ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  updateWorkspacePermissionsContract,
  type WorkspacePermission,
} from '@/lib/api/contracts/workspaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { ForbiddenOperationError } from '@/lib/core/application'
import { HttpError } from '@/lib/core/utils/http-error'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { isRetryableTransactionError, withTransactionRetry } from '@/lib/db/transaction'
import type { DbOrTx } from '@/lib/db/types'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getEffectiveWorkspacePermission,
  getWorkspacePermissionsForViewer,
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'
import { assertMembershipNotScimManaged } from '@/ee/scim/lib/managed-membership'

const logger = createLogger('WorkspacesPermissionsAPI')

/**
 * A target's permission row no longer matched at write time — it was removed,
 * or replaced, by a concurrent writer. Thrown inside the transaction so the
 * whole batch rolls back instead of resurrecting a revoked collaborator or
 * writing a role decided against stale standing.
 *
 * `message` reaches the client verbatim via `withRouteHandler`, so it is worded
 * for the person who clicked.
 */
class StaleWorkspaceMembershipError extends HttpError {
  readonly statusCode = 409
  readonly userId: string

  constructor(userId: string) {
    super("This member's access just changed. Refresh and try again.")
    this.name = 'StaleWorkspaceMembershipError'
    this.userId = userId
  }
}

/**
 * The caller's own workspace admin standing was revoked while the request was in
 * flight. Authority is checked before the body is parsed, several reads ahead of
 * the write, so it is re-read under lock inside the transaction — otherwise a
 * just-demoted admin's in-flight batch still commits.
 */
class WorkspaceAdminRevokedError extends HttpError {
  readonly statusCode = 409

  constructor() {
    super('Your workspace permissions changed. Refresh and try again.')
    this.name = 'WorkspaceAdminRevokedError'
  }
}

/**
 * The workspace moved under the request — ownership transferred, the billed
 * account changed, or it joined/left an organization — so a guard that passed
 * on the pre-flight read no longer holds against the locked row.
 */
class WorkspaceContextChangedError extends HttpError {
  readonly statusCode = 409

  constructor() {
    super('This workspace just changed. Refresh and try again.')
    this.name = 'WorkspaceContextChangedError'
  }
}

/**
 * Another writer held the rows for longer than every attempt allowed. Distinct
 * from the conflicts above: nothing about the request is wrong and the state is
 * unchanged, so the answer is to retry rather than to reload — and it must not
 * reach the client as a generic server error, which is what bounding the lock
 * wait would otherwise have produced.
 */
class WorkspaceBusyError extends HttpError {
  readonly statusCode = 409

  constructor() {
    super('This workspace is busy right now. Try again in a moment.')
    this.name = 'WorkspaceBusyError'
  }
}

/** A target whose membership the organization's directory owns; the guard's own wording names the remedy. */
class DirectoryManagedMemberError extends HttpError {
  readonly statusCode = 403

  constructor(cause: ForbiddenOperationError) {
    super(cause.message)
    this.name = 'DirectoryManagedMemberError'
  }
}

/**
 * Bounds the wait on the row locks below so a stuck holder fails fast
 * (SQLSTATE 55P03) instead of parking a pooled connection indefinitely.
 *
 * Kept short because `withTransactionRetry` retries that timeout: the connection
 * is released between attempts, so three bounded waits contend better than one
 * long one and never pin a pool slot for more than this.
 */
const PERMISSIONS_LOCK_TIMEOUT_MS = 3000

/** Organization owners/admins among `userIds`, empty for a personal workspace. */
async function loadOrgAdminTargets(
  executor: DbOrTx,
  organizationId: string | null,
  userIds: string[]
): Promise<Set<string>> {
  if (!organizationId) return new Set()
  const rows = await executor
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        inArray(member.userId, userIds),
        inArray(member.role, [...ORG_ADMIN_ROLES])
      )
    )
  return new Set(rows.map((row) => row.userId))
}

/**
 * Roles that are inherited rather than granted, and so cannot be edited here.
 *
 * Every input is workspace state that another request can change underneath
 * this one, so this runs twice: once on the pre-flight read to answer with the
 * specific reason, and once inside the transaction against the locked row. One
 * function so the two evaluations cannot drift.
 */
function findInheritedRoleViolation(
  updates: readonly { userId: string; permissions: WorkspacePermission }[],
  state: {
    ownerId: string
    billedAccountUserId: string | null
    orgAdminUserIds: ReadonlySet<string>
  }
): string | null {
  if (updates.some((update) => state.orgAdminUserIds.has(update.userId))) {
    return 'Organization admins are workspace admins and their role cannot be changed'
  }
  if (updates.some((update) => update.userId === state.ownerId && update.permissions !== 'admin')) {
    return 'The workspace owner must retain admin permissions'
  }
  const billedAccountUserId = state.billedAccountUserId
  if (
    billedAccountUserId &&
    updates.some(
      (update) => update.userId === billedAccountUserId && update.permissions !== 'admin'
    )
  ) {
    return 'Workspace billing account must retain admin permissions'
  }
  return null
}

/**
 * GET /api/workspaces/[id]/permissions
 *
 * Retrieves all users who have permissions for the specified workspace.
 * Returns user details along with their specific permissions.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @returns Array of users with their permissions for the workspace
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const result = await getWorkspacePermissionsForViewer(workspaceId, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    return NextResponse.json(result)
  }
)

/**
 * PATCH /api/workspaces/[id]/permissions
 *
 * Updates permissions for existing workspace members.
 * Only admin users can update permissions.
 *
 * Every target must already hold a workspace permission row — this endpoint
 * cannot introduce a member. Adding one goes through the invitation flow, which
 * enforces the plan, seat, and consent gates.
 *
 * Each change is an in-place UPDATE of the existing row, so the row's
 * `createdAt` (surfaced as the member's joined date) survives a role change, and
 * a target removed concurrently matches no row and yields a 409 rather than
 * being re-created.
 *
 * Roles that are inherited rather than granted cannot be edited here, matching
 * the lock the members list shows: the workspace owner, organization
 * owners/admins, the billing account, and the caller's own admin. The caller's
 * authority is re-read under lock inside the transaction, so a batch from an
 * admin who was demoted mid-request does not commit.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @param updates - Array of permission updates for existing members
 * @returns Success message or error
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await context.params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)

    if (!hasAdminAccess) {
      return NextResponse.json(
        { error: 'Admin access required to update permissions' },
        { status: 403 }
      )
    }

    /**
     * The default validation response reports a generic "Validation error" and
     * puts the authored message in `details`, which the client never reads — so
     * the duplicate-userId, batch-size, and id-length rules would all surface as
     * the same unhelpful string.
     */
    const parsed = await parseRequest(updateWorkspacePermissionsContract, request, context, {
      validationErrorResponse: (error) =>
        NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
    })
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    const workspaceRow = await db
      .select({
        ownerId: workspace.ownerId,
        billedAccountUserId: workspace.billedAccountUserId,
        organizationId: workspace.organizationId,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceRow.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const ownerId = workspaceRow[0].ownerId
    const billedAccountUserId = workspaceRow[0].billedAccountUserId
    const organizationId = workspaceRow[0].organizationId

    const targetUserIds = body.updates.map((update) => update.userId)

    /**
     * Current standing and display name for the targets. Scoped to the targets:
     * nothing downstream reads a non-target row, and an unscoped read
     * materializes every member of the workspace on a single-role change.
     */
    const existingPerms = await db
      .select({
        userId: permissions.userId,
        email: user.email,
      })
      .from(permissions)
      .innerJoin(user, eq(permissions.userId, user.id))
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          inArray(permissions.userId, targetUserIds)
        )
      )

    const emailByUserId = new Map(existingPerms.map((row) => [row.userId, row.email]))

    const orgAdminUserIds = await loadOrgAdminTargets(db, organizationId, targetUserIds)

    /**
     * Membership is checked before anything else about the target, so the
     * inherited-role answers below only ever describe someone the caller can
     * already see in the members list. Checking them first made this an oracle:
     * it would tell any caller whether an arbitrary userId was the workspace's
     * billing account.
     *
     * "Member" therefore means what the members list means — an explicit row OR
     * a derived organization admin. Organization admins hold no permission row,
     * so testing rows alone would answer "not a member" about someone the caller
     * is looking at, instead of explaining why their role is fixed.
     *
     * This endpoint only *changes* standing, never grants it. Adding a
     * collaborator belongs to the invitation flow, which owns the gates this
     * route cannot apply — the external-collaborator paid-plan requirement,
     * seat provisioning, and the invitee's acceptance.
     */
    const nonMemberUserIds = targetUserIds.filter(
      (userId) => !emailByUserId.has(userId) && !orgAdminUserIds.has(userId)
    )
    if (nonMemberUserIds.length > 0) {
      logger.warn('Rejected permission update for non-members', {
        workspaceId,
        nonMemberCount: nonMemberUserIds.length,
      })
      return NextResponse.json(
        { error: 'Only existing workspace members can have their permissions updated' },
        { status: 400 }
      )
    }

    if (
      body.updates.some(
        (update) => update.userId === session.user.id && update.permissions !== 'admin'
      )
    ) {
      return NextResponse.json(
        { error: 'Cannot remove your own admin permissions' },
        { status: 400 }
      )
    }

    const preflightViolation = findInheritedRoleViolation(body.updates, {
      ownerId,
      billedAccountUserId,
      orgAdminUserIds,
    })
    if (preflightViolation) {
      return NextResponse.json({ error: preflightViolation }, { status: 400 })
    }

    /**
     * Retried on contention: the ordered locks below close this route against
     * itself, but member removal takes the billed account before the departing
     * user, so a cross-path cycle remains — and the `lock_timeout` above turns a
     * slow competing writer into an abort of its own. Both are the database
     * asking for a retry, and answering either with a 500 would surface as
     * "Internal server error" for a click that would have worked.
     */
    const { previousRoles, changedUserIds } = await withTransactionRetry(async (tx) => {
      await tx.execute(
        sql`select set_config('lock_timeout', ${`${PERMISSIONS_LOCK_TIMEOUT_MS}ms`}, true)`
      )

      /**
       * An inherited org-admin grant lives in `member`, not `permissions`, so it
       * is fenced separately — and first, so every invocation of this route takes
       * the tables in the same order. Same order as
       * `validateLockedWorkspaceInvitationContext`: member, workspace, permissions.
       */
      const lockUserIds = [...new Set([session.user.id, ...targetUserIds])]

      /**
       * The caller's inherited authority and the targets' inherited-admin standing
       * both live here, so both are locked — in one ordered statement, so `member`
       * has a total acquisition order for the same reason `permissions` does
       * below. Locking only the caller left a target's promotion to organization
       * admin able to land between the guard and the write.
       */
      let orgAdminUserIds: ReadonlySet<string> = new Set()
      if (organizationId) {
        const lockedMembers = await tx
          .select({ userId: member.userId, role: member.role })
          .from(member)
          .where(
            and(eq(member.organizationId, organizationId), inArray(member.userId, lockUserIds))
          )
          .orderBy(member.userId)
          .for('update')
        orgAdminUserIds = new Set(
          lockedMembers.filter((row) => isOrgAdminRole(row.role)).map((row) => row.userId)
        )
        /**
         * A directory that owns membership also owns the workspace role it set,
         * so the change is refused here for the same reason an invitation is:
         * the next sync would revert it. Checked under the member lock so a
         * connection enabled mid-request cannot slip a change past it.
         */
        for (const userId of targetUserIds) {
          await assertMembershipNotScimManaged({ organizationId, userId, executor: tx })
        }
      }

      /**
       * `ownerId`, `billedAccountUserId`, and `organizationId` were read
       * unlocked, and a workspace admin can move all three from other endpoints
       * — ownership transfers when the owner is removed, and the billed account
       * is directly settable. Re-reading them under lock is what stops a batch
       * vetted against the old row from demoting whoever those columns point at
       * now, which would strand a workspace owner on `read` with no way back.
       */
      const lockedWorkspace = await getWorkspaceWithOwner(workspaceId, {
        executor: tx,
        forUpdate: true,
      })
      if (!lockedWorkspace || lockedWorkspace.organizationId !== organizationId) {
        throw new WorkspaceContextChangedError()
      }

      const lockedViolation = findInheritedRoleViolation(body.updates, {
        ownerId: lockedWorkspace.ownerId,
        billedAccountUserId: lockedWorkspace.billedAccountUserId,
        orgAdminUserIds,
      })
      if (lockedViolation) {
        logger.warn('Permission update raced a workspace change', {
          workspaceId,
          reason: lockedViolation,
        })
        throw new WorkspaceContextChangedError()
      }

      /**
       * One ordered lock over the caller's row and every target's, which is what
       * makes the batch deadlock-free against another invocation of this route:
       * `ORDER BY` sits below `FOR UPDATE`, so Postgres acquires the row locks in
       * userId order no matter what order the request listed them in. Including
       * the caller matters — two admins editing each other would otherwise take
       * self-then-target in opposite orders and deadlock.
       *
       * It does not order against other writers of these rows (member removal
       * takes the billed account before the departing user), so it closes this
       * route against itself rather than closing the table globally.
       */
      const lockedRows = await tx
        .select({ userId: permissions.userId, permissionType: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId),
            inArray(permissions.userId, lockUserIds)
          )
        )
        .orderBy(permissions.userId)
        .for('update')

      const lockedByUserId = new Map(lockedRows.map((row) => [row.userId, row.permissionType]))

      /**
       * Re-establish the caller's authority now that it cannot change again.
       * `hasWorkspaceAdminAccess` ran before the body was parsed and several
       * reads ago, so without this a batch from an admin demoted mid-request
       * still commits.
       */
      const callerPermission = await getEffectiveWorkspacePermission(
        session.user.id,
        { id: workspaceId, organizationId },
        tx
      )
      if (callerPermission !== 'admin') {
        logger.warn('Permission update raced revocation of the caller', {
          workspaceId,
          actorId: session.user.id,
        })
        throw new WorkspaceAdminRevokedError()
      }

      /**
       * The membership check above ran unlocked; this is the authoritative one.
       * A target missing here was removed in between, so the batch rolls back
       * rather than reviving it.
       */
      const removedUserId = targetUserIds.find((userId) => !lockedByUserId.has(userId))
      if (removedUserId !== undefined) {
        logger.warn('Permission update raced a concurrent membership change', {
          workspaceId,
          userId: removedUserId,
        })
        throw new StaleWorkspaceMembershipError(removedUserId)
      }

      /**
       * Entries that ask for the role the member already holds are dropped
       * rather than rewritten. Writing them would bump `updatedAt` and emit a
       * `MEMBER_ROLE_CHANGED` audit entry reading "from admin to admin" — noise
       * in the trail, and a false positive for anything watching `updatedAt` to
       * detect real changes.
       *
       * Targets sharing a role then share a statement, so the batch costs one
       * write per distinct role — at most three — instead of one per member.
       * Every row is already locked, so the order the groups run in has no
       * bearing on lock acquisition. Relies on the contract rejecting a repeated
       * `userId`: without that a user could land in two groups and their final
       * role would depend on which group ran last.
       */
      const changedUpdates = body.updates.filter(
        (update) => lockedByUserId.get(update.userId) !== update.permissions
      )
      const userIdsByPermission = new Map<WorkspacePermission, string[]>()
      for (const update of changedUpdates) {
        const group = userIdsByPermission.get(update.permissions)
        if (group) group.push(update.userId)
        else userIdsByPermission.set(update.permissions, [update.userId])
      }

      /**
       * One timestamp for the batch: it commits atomically, so the rows should
       * not disagree about when they changed.
       */
      const updatedAt = new Date()
      for (const [permission, userIds] of userIdsByPermission) {
        await tx
          .update(permissions)
          .set({ permissionType: permission, updatedAt })
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId),
              inArray(permissions.userId, userIds)
            )
          )
      }

      return {
        previousRoles: lockedByUserId,
        changedUserIds: new Set(changedUpdates.map((update) => update.userId)),
      }
    }).catch((error) => {
      /**
       * Contention that outlived every attempt. Answering with the driver error
       * would render as "Internal server error" for a request that is simply
       * queued behind another writer.
       */
      if (isRetryableTransactionError(error)) {
        logger.warn('Permission update exhausted retries under contention', {
          workspaceId,
          code: getPostgresErrorCode(error),
        })
        throw new WorkspaceBusyError()
      }
      if (error instanceof ForbiddenOperationError) throw new DirectoryManagedMemberError(error)
      throw error
    })

    /**
     * The change is durable from here on, so it is recorded before anything
     * that can still throw. Ordering this after the reads below meant a
     * transient failure in them produced a committed but entirely unaudited
     * role change.
     */
    for (const update of body.updates) {
      if (!changedUserIds.has(update.userId)) continue

      captureServerEvent(
        session.user.id,
        'workspace_member_role_changed',
        { workspace_id: workspaceId, new_role: update.permissions },
        { groups: { workspace: workspaceId } }
      )

      /**
       * `previousRole` comes from the locked read, not the unlocked one above:
       * the pre-flight snapshot can be overtaken by another admin's change, and
       * recording a transition that never happened corrupts the trail.
       */
      const targetEmail = emailByUserId.get(update.userId)
      const previousRole = previousRoles.get(update.userId) ?? null

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        resourceName: targetEmail ?? update.userId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Changed permissions for ${targetEmail ?? update.userId} from ${previousRole ?? 'unknown'} to ${update.permissions}`,
        metadata: {
          targetUserId: update.userId,
          targetEmail: targetEmail ?? undefined,
          previousRole,
          newRole: update.permissions,
        },
        request,
      })
    }

    /**
     * Credential membership follows workspace access, but it cannot join the
     * transaction above and the role change is already committed. A failure
     * anywhere past the commit is therefore a reconciliation task, not a reason
     * to answer 500 — that would misreport the committed change and invite a
     * retry that changes nothing. The read that feeds the sync is inside the
     * guard for the same reason.
     */
    try {
      const [wsEnvRow] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))
        .limit(1)
      const wsEnvKeys = Object.keys((wsEnvRow?.variables as Record<string, string>) || {})
      if (wsEnvKeys.length > 0) {
        await syncWorkspaceEnvCredentials({
          workspaceId,
          envKeys: wsEnvKeys,
          actingUserId: session.user.id,
        })
      }
    } catch (error) {
      logger.error('Workspace env credential membership needs reconciliation', {
        workspaceId,
        targetUserIds,
        error,
      })
    }

    return NextResponse.json({ message: 'Permissions updated successfully' })
  }
)
