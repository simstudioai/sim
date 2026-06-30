import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroupMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { addPermissionGroupMemberContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PERMISSION_GROUP_MEMBER_CONSTRAINTS } from '@/lib/permission-groups/types'
import { isOrganizationMember } from '@/lib/workspaces/permissions/utils'
import {
  type AllMembersConflict,
  acquirePermissionGroupOrgLock,
  authorizeOrgAccessControl,
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
  formatAllMembersConflictError,
  formatScopeConflictError,
  getGroupWorkspaces,
  loadGroupInOrganization,
  type ScopeConflict,
} from '@/app/api/organizations/[id]/permission-groups/utils'

const logger = createLogger('OrganizationPermissionGroupMembers')

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, groupId: id } = await params

    const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
    if (denied) return denied

    const group = await loadGroupInOrganization(id, organizationId)
    if (!group) {
      return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
    }

    const members = await db
      .select({
        id: permissionGroupMember.id,
        userId: permissionGroupMember.userId,
        assignedAt: permissionGroupMember.assignedAt,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(permissionGroupMember)
      .leftJoin(user, eq(permissionGroupMember.userId, user.id))
      .where(eq(permissionGroupMember.permissionGroupId, id))

    return NextResponse.json({ members })
  }
)

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

      const parsed = await parseRequest(addPermissionGroupMemberContract, req, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response
      const { userId } = parsed.data.body

      const isMember = await isOrganizationMember(userId, organizationId)
      if (!isMember) {
        return NextResponse.json(
          { error: 'User is not a member of this organization' },
          { status: 400 }
        )
      }

      const newMember = await db.transaction(async (tx) => {
        // Serialize all permission-group writes for this org so the conflict
        // check and insert are atomic. Without it, two concurrent adds (or a
        // concurrent scope change) could both pass findScopeConflicts and place
        // the user in two groups that overlap on a workspace.
        await acquirePermissionGroupOrgLock(tx, organizationId)

        // Re-read the group under the lock: a concurrent scope change may have
        // changed its workspaces since the pre-transaction load, so the conflict
        // check uses one consistent snapshot.
        const lockedGroup = await loadGroupInOrganization(id, organizationId, tx)
        if (!lockedGroup) {
          throw new Error('GROUP_NOT_FOUND')
        }

        const [existingInGroup] = await tx
          .select({ id: permissionGroupMember.id })
          .from(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.permissionGroupId, id),
              eq(permissionGroupMember.userId, userId)
            )
          )
          .limit(1)

        if (existingInGroup) {
          throw new Error('ALREADY_IN_GROUP')
        }

        // A user may belong to multiple groups, but only one may govern any given
        // workspace. Reject when the user is already an explicit member of another
        // group that shares one of this group's workspaces.
        const groupWorkspaceIds = (await getGroupWorkspaces(id, tx)).map((ws) => ws.id)
        const conflicts = await findScopeConflicts(
          {
            organizationId,
            excludeGroupId: id,
            workspaceIds: groupWorkspaceIds,
            candidateUserIds: [userId],
          },
          tx
        )
        if (conflicts.length > 0) {
          scopeConflicts = conflicts
          throw new Error('SCOPE_CONFLICT')
        }

        const memberData = {
          id: generateId(),
          permissionGroupId: id,
          organizationId,
          userId,
          assignedBy: session.user.id,
          assignedAt: new Date(),
        }

        await tx.insert(permissionGroupMember).values(memberData)
        return memberData
      })

      logger.info('Added member to permission group', {
        permissionGroupId: id,
        organizationId,
        userId,
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
        description: `Added member ${userId} to permission group "${group.name}"`,
        metadata: {
          organizationId,
          targetUserId: userId,
          permissionGroupId: id,
        },
        request: req,
      })

      return NextResponse.json({ member: newMember }, { status: 201 })
    } catch (error) {
      if (error instanceof Error && error.message === 'GROUP_NOT_FOUND') {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }
      if (error instanceof Error && error.message === 'ALREADY_IN_GROUP') {
        return NextResponse.json(
          { error: 'User is already in this permission group' },
          { status: 409 }
        )
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
          { error: 'User is already in this permission group' },
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
      logger.error('Error adding member to permission group', error)
      return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, groupId: id } = await params
    const { searchParams } = new URL(req.url)
    const memberId = searchParams.get('memberId')

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    // Populated inside the transaction when an all-members scope conflict is
    // detected, so the catch can format the 409 after the rollback.
    let allMembersConflict: AllMembersConflict | null = null

    try {
      const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
      if (denied) return denied

      const group = await loadGroupInOrganization(id, organizationId)
      if (!group) {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }

      const memberToRemove = await db.transaction(async (tx) => {
        // Serialize permission-group writes for this org so the last-member check
        // and the delete commit atomically: removing the last member turns a
        // workspace group into an all-members group, which is unique per workspace.
        await acquirePermissionGroupOrgLock(tx, organizationId)

        const lockedGroup = await loadGroupInOrganization(id, organizationId, tx)
        if (!lockedGroup) {
          throw new Error('GROUP_NOT_FOUND')
        }

        const [member] = await tx
          .select({
            id: permissionGroupMember.id,
            userId: permissionGroupMember.userId,
            email: user.email,
          })
          .from(permissionGroupMember)
          .innerJoin(user, eq(permissionGroupMember.userId, user.id))
          .where(
            and(
              eq(permissionGroupMember.id, memberId),
              eq(permissionGroupMember.permissionGroupId, id)
            )
          )
          .limit(1)

        if (!member) {
          throw new Error('MEMBER_NOT_FOUND')
        }

        if (!lockedGroup.isDefault) {
          const [memberCountRow] = await tx
            .select({ value: count() })
            .from(permissionGroupMember)
            .where(eq(permissionGroupMember.permissionGroupId, id))
          if ((memberCountRow?.value ?? 0) <= 1) {
            const workspaceIds = (await getGroupWorkspaces(id, tx)).map((ws) => ws.id)
            const conflict = await findAllMembersWorkspaceConflict(
              { organizationId, excludeGroupId: id, workspaceIds },
              tx
            )
            if (conflict) {
              allMembersConflict = conflict
              throw new Error('ALL_MEMBERS_CONFLICT')
            }
          }
        }

        await tx.delete(permissionGroupMember).where(eq(permissionGroupMember.id, memberId))
        return member
      })

      logger.info('Removed member from permission group', {
        permissionGroupId: id,
        organizationId,
        memberId,
        userId: session.user.id,
      })

      recordAudit({
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_MEMBER_REMOVED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        resourceName: group.name,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Removed member ${memberToRemove.userId} from permission group "${group.name}"`,
        metadata: {
          organizationId,
          targetUserId: memberToRemove.userId,
          targetEmail: memberToRemove.email ?? undefined,
          memberId,
          permissionGroupId: id,
        },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof Error && error.message === 'GROUP_NOT_FOUND') {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }
      if (error instanceof Error && error.message === 'MEMBER_NOT_FOUND') {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }
      if (
        error instanceof Error &&
        error.message === 'ALL_MEMBERS_CONFLICT' &&
        allMembersConflict
      ) {
        return NextResponse.json(
          { error: formatAllMembersConflictError(allMembersConflict) },
          { status: 409 }
        )
      }
      if (getPostgresErrorCode(error) === '55P03') {
        return NextResponse.json(
          { error: 'This group is being updated by another request. Please try again.' },
          { status: 503 }
        )
      }
      logger.error('Error removing member from permission group', error)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }
  }
)
