import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissions, user } from '@sim/db/schema'
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
import { checkWorkspaceAccess, hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacePermissionGroupMembers')

async function loadGroupInWorkspace(groupId: string, workspaceId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      workspaceId: permissionGroup.workspaceId,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.workspaceId, workspaceId)))
    .limit(1)

  return group ?? null
}

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, groupId: id } = await params

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (!access.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

const addMemberSchema = z.object({
  userId: z.string().min(1),
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
      const { userId } = addMemberSchema.parse(body)

      const [workspaceMember] = await db
        .select({ email: user.email })
        .from(permissions)
        .innerJoin(user, eq(permissions.userId, user.id))
        .where(
          and(
            eq(permissions.userId, userId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!workspaceMember) {
        return NextResponse.json(
          { error: 'User does not have access to this workspace' },
          { status: 400 }
        )
      }

      const newMember = await db.transaction(async (tx) => {
        const existingInWorkspace = await tx
          .select({
            id: permissionGroupMember.id,
            permissionGroupId: permissionGroupMember.permissionGroupId,
          })
          .from(permissionGroupMember)
          .innerJoin(
            permissionGroup,
            eq(permissionGroupMember.permissionGroupId, permissionGroup.id)
          )
          .where(
            and(
              eq(permissionGroupMember.userId, userId),
              eq(permissionGroup.workspaceId, workspaceId)
            )
          )

        if (existingInWorkspace.some((row) => row.permissionGroupId === id)) {
          throw new Error('ALREADY_IN_GROUP')
        }

        if (existingInWorkspace.length > 0) {
          await tx.delete(permissionGroupMember).where(
            inArray(
              permissionGroupMember.id,
              existingInWorkspace.map((row) => row.id)
            )
          )
        }

        const memberData = {
          id: generateId(),
          permissionGroupId: id,
          workspaceId,
          userId,
          assignedBy: session.user.id,
          assignedAt: new Date(),
        }

        await tx.insert(permissionGroupMember).values(memberData)
        return memberData
      })

      logger.info('Added member to permission group', {
        permissionGroupId: id,
        workspaceId,
        userId,
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
        description: `Added member ${userId} to permission group "${group.name}"`,
        metadata: {
          targetUserId: userId,
          targetEmail: workspaceMember.email ?? undefined,
          permissionGroupId: id,
        },
        request: req,
      })

      return NextResponse.json({ member: newMember }, { status: 201 })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
      }
      if (error instanceof Error && error.message === 'ALREADY_IN_GROUP') {
        return NextResponse.json(
          { error: 'User is already in this permission group' },
          { status: 409 }
        )
      }
      if (getPostgresErrorCode(error) === '23505') {
        const constraint = getPostgresConstraintName(error)
        if (constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.workspaceUser) {
          return NextResponse.json(
            {
              error:
                'User was concurrently added to another group in this workspace. Please refresh and try again.',
            },
            { status: 409 }
          )
        }
        if (constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser) {
          return NextResponse.json(
            { error: 'User is already in this permission group' },
            { status: 409 }
          )
        }
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

    const { id: workspaceId, groupId: id } = await params
    const { searchParams } = new URL(req.url)
    const memberId = searchParams.get('memberId')

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

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

      const [memberToRemove] = await db
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

      if (!memberToRemove) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }

      await db.delete(permissionGroupMember).where(eq(permissionGroupMember.id, memberId))

      logger.info('Removed member from permission group', {
        permissionGroupId: id,
        workspaceId,
        memberId,
        userId: session.user.id,
      })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_MEMBER_REMOVED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        resourceName: group.name,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Removed member ${memberToRemove.userId} from permission group "${group.name}"`,
        metadata: {
          targetUserId: memberToRemove.userId,
          targetEmail: memberToRemove.email ?? undefined,
          memberId,
          permissionGroupId: id,
        },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error removing member from permission group', error)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }
  }
)
