import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { bulkAddPermissionGroupMembersContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PERMISSION_GROUP_MEMBER_CONSTRAINTS } from '@/lib/permission-groups/types'
import {
  acquirePermissionGroupOrgLock,
  authorizeOrgAccessControl,
  findScopeConflicts,
  formatScopeConflictError,
  getGroupWorkspaces,
  loadGroupInOrganization,
  type ScopeConflict,
} from '@/app/api/organizations/[id]/permission-groups/utils'

const logger = createLogger('OrganizationPermissionGroupBulkMembers')

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, groupId: id } = await context.params

    // Populated inside the transaction when a scope conflict is detected, so the
    // catch can format the 409 after the rollback.
    let scopeConflicts: ScopeConflict[] = []

    try {
      const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
      if (denied) return denied

      const group = await loadGroupInOrganization(id, organizationId)
      if (!group) {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }

      const parsed = await parseRequest(bulkAddPermissionGroupMembersContract, req, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response
      const { userIds, addAllOrganizationMembers } = parsed.data.body

      let targetUserIds: string[] = []

      if (addAllOrganizationMembers) {
        const orgMembers = await db
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.organizationId, organizationId))

        targetUserIds = Array.from(new Set(orgMembers.map((m) => m.userId)))
      } else if (userIds && userIds.length > 0) {
        const uniqueUserIds = Array.from(new Set(userIds))
        const validMembers = await db
          .select({ userId: member.userId })
          .from(member)
          .where(
            and(eq(member.organizationId, organizationId), inArray(member.userId, uniqueUserIds))
          )

        targetUserIds = Array.from(new Set(validMembers.map((m) => m.userId)))
      }

      if (targetUserIds.length === 0) {
        return NextResponse.json({ added: 0, skipped: 0 })
      }

      const { addedUserIds } = await db.transaction(async (tx) => {
        // Serialize all permission-group writes for this org so the conflict
        // check and inserts are atomic against concurrent adds or scope changes.
        await acquirePermissionGroupOrgLock(tx, organizationId)

        // Re-read the group under the lock: a concurrent scope change may have
        // changed its workspaces since the pre-transaction load, so the conflict
        // check uses one consistent snapshot.
        const lockedGroup = await loadGroupInOrganization(id, organizationId, tx)
        if (!lockedGroup) {
          throw new Error('GROUP_NOT_FOUND')
        }

        // Bulk add is all-or-nothing for conflicts: if any selected user is
        // already an explicit member of another group sharing one of this group's
        // workspaces, add nobody and surface the conflict so the admin can fix the
        // selection. Members already in this group are no-ops.
        const groupWorkspaceIds = (await getGroupWorkspaces(id, tx)).map((ws) => ws.id)
        const conflicts = await findScopeConflicts(
          {
            organizationId,
            excludeGroupId: id,
            workspaceIds: groupWorkspaceIds,
            candidateUserIds: targetUserIds,
          },
          tx
        )
        if (conflicts.length > 0) {
          scopeConflicts = conflicts
          throw new Error('SCOPE_CONFLICT')
        }

        const existingInGroup = await tx
          .select({ userId: permissionGroupMember.userId })
          .from(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.permissionGroupId, id),
              inArray(permissionGroupMember.userId, targetUserIds)
            )
          )
        const alreadyInThisGroup = new Set(existingInGroup.map((m) => m.userId))

        const usersToAdd = targetUserIds.filter((uid) => !alreadyInThisGroup.has(uid))

        if (usersToAdd.length === 0) {
          return { addedUserIds: [] as string[] }
        }

        const newMembers = usersToAdd.map((userId) => ({
          id: generateId(),
          permissionGroupId: id,
          organizationId,
          userId,
          assignedBy: session.user.id,
          assignedAt: new Date(),
        }))

        await tx.insert(permissionGroupMember).values(newMembers)

        return { addedUserIds: usersToAdd }
      })

      const skipped = targetUserIds.length - addedUserIds.length

      if (addedUserIds.length === 0) {
        return NextResponse.json({ added: 0, skipped })
      }

      logger.info('Bulk added members to permission group', {
        permissionGroupId: id,
        organizationId,
        addedCount: addedUserIds.length,
        skipped,
        assignedBy: session.user.id,
      })

      recordAudit({
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        resourceName: group.name,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Bulk added ${addedUserIds.length} member(s) to permission group "${group.name}"`,
        metadata: {
          organizationId,
          permissionGroupId: id,
          addedUserIds,
          skipped,
        },
        request: req,
      })

      return NextResponse.json({ added: addedUserIds.length, skipped })
    } catch (error) {
      if (error instanceof Error && error.message === 'GROUP_NOT_FOUND') {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }
      if (error instanceof Error && error.message === 'SCOPE_CONFLICT') {
        return NextResponse.json(
          { error: formatScopeConflictError(scopeConflicts) },
          { status: 409 }
        )
      }
      if (
        getPostgresErrorCode(error) === '23505' &&
        getPostgresConstraintName(error) === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser
      ) {
        return NextResponse.json(
          {
            error:
              'One or more users were concurrently added to this group. Please refresh and try again.',
          },
          { status: 409 }
        )
      }
      // Advisory lock wait exceeded (lock_timeout) — transient contention.
      if (getPostgresErrorCode(error) === '55P03') {
        return NextResponse.json(
          { error: 'This group is being updated by another request. Please try again.' },
          { status: 503 }
        )
      }
      logger.error('Error bulk adding members to permission group', error)
      return NextResponse.json({ error: 'Failed to add members' }, { status: 500 })
    }
  }
)
