import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember } from '@sim/db/schema'
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
  authorizeOrgAccessControl,
  loadGroupInOrganization,
} from '@/app/api/organizations/[id]/permission-groups/utils'

const logger = createLogger('OrganizationPermissionGroupBulkMembers')

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, groupId: id } = await context.params

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
        return NextResponse.json({ added: 0, moved: 0 })
      }

      const { addedUserIds, movedCount } = await db.transaction(async (tx) => {
        const existingMemberships = await tx
          .select({
            id: permissionGroupMember.id,
            userId: permissionGroupMember.userId,
            permissionGroupId: permissionGroupMember.permissionGroupId,
          })
          .from(permissionGroupMember)
          .innerJoin(
            permissionGroup,
            eq(permissionGroupMember.permissionGroupId, permissionGroup.id)
          )
          .where(
            and(
              eq(permissionGroup.organizationId, organizationId),
              inArray(permissionGroupMember.userId, targetUserIds)
            )
          )

        const alreadyInThisGroup = new Set(
          existingMemberships.filter((m) => m.permissionGroupId === id).map((m) => m.userId)
        )
        const usersToAdd = targetUserIds.filter((uid) => !alreadyInThisGroup.has(uid))

        if (usersToAdd.length === 0) {
          return { addedUserIds: [] as string[], movedCount: 0 }
        }

        const membershipsToDelete = existingMemberships.filter(
          (m) => m.permissionGroupId !== id && usersToAdd.includes(m.userId)
        )

        if (membershipsToDelete.length > 0) {
          await tx.delete(permissionGroupMember).where(
            inArray(
              permissionGroupMember.id,
              membershipsToDelete.map((m) => m.id)
            )
          )
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

        return { addedUserIds: usersToAdd, movedCount: membershipsToDelete.length }
      })

      if (addedUserIds.length === 0) {
        return NextResponse.json({ added: 0, moved: 0 })
      }

      logger.info('Bulk added members to permission group', {
        permissionGroupId: id,
        organizationId,
        addedCount: addedUserIds.length,
        movedCount,
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
          movedCount,
        },
        request: req,
      })

      return NextResponse.json({ added: addedUserIds.length, moved: movedCount })
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        const constraint = getPostgresConstraintName(error)
        if (
          constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.organizationUser ||
          constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser
        ) {
          return NextResponse.json(
            {
              error:
                'One or more users were concurrently added to a group in this organization. Please refresh and try again.',
            },
            { status: 409 }
          )
        }
      }
      logger.error('Error bulk adding members to permission group', error)
      return NextResponse.json({ error: 'Failed to add members' }, { status: 500 })
    }
  }
)
