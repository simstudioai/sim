import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PERMISSION_GROUP_MEMBER_CONSTRAINTS } from '@/lib/permission-groups/types'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacePermissionGroupBulkMembers')

async function loadGroupInWorkspace(groupId: string, workspaceId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      workspaceId: permissionGroup.workspaceId,
      name: permissionGroup.name,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.workspaceId, workspaceId)))
    .limit(1)

  return group ?? null
}

const bulkAddSchema = z.object({
  userIds: z.array(z.string()).optional(),
  addAllWorkspaceMembers: z.boolean().optional(),
})

export const POST = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, groupId: id } = await params

    try {
      const isWorkspaceAdmin = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
      if (!isWorkspaceAdmin) {
        return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
      }

      const entitled = await isWorkspaceOnEnterprisePlan(workspaceId)
      if (!entitled) {
        return NextResponse.json(
          { error: 'Access Control is an Enterprise feature' },
          { status: 403 }
        )
      }

      const group = await loadGroupInWorkspace(id, workspaceId)
      if (!group) {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }

      const body = await req.json()
      const { userIds, addAllWorkspaceMembers } = bulkAddSchema.parse(body)

      let targetUserIds: string[] = []

      if (addAllWorkspaceMembers) {
        const workspaceMembers = await db
          .select({ userId: permissions.userId })
          .from(permissions)
          .where(
            and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))
          )

        targetUserIds = Array.from(new Set(workspaceMembers.map((m) => m.userId)))
      } else if (userIds && userIds.length > 0) {
        const uniqueUserIds = Array.from(new Set(userIds))
        const validMembers = await db
          .select({ userId: permissions.userId })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId),
              inArray(permissions.userId, uniqueUserIds)
            )
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
              eq(permissionGroup.workspaceId, workspaceId),
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
          workspaceId,
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
        workspaceId,
        addedCount: addedUserIds.length,
        movedCount,
        assignedBy: session.user.id,
      })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        resourceName: group.name,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Bulk added ${addedUserIds.length} member(s) to permission group "${group.name}"`,
        metadata: {
          permissionGroupId: id,
          addedUserIds,
          movedCount,
        },
        request: req,
      })

      return NextResponse.json({ added: addedUserIds.length, moved: movedCount })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
      }
      if (getPostgresErrorCode(error) === '23505') {
        const constraint = getPostgresConstraintName(error)
        if (
          constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.workspaceUser ||
          constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser
        ) {
          return NextResponse.json(
            {
              error:
                'One or more users were concurrently added to a group in this workspace. Please refresh and try again.',
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
