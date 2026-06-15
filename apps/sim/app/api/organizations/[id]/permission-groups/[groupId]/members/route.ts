import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { addPermissionGroupMemberContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PERMISSION_GROUP_MEMBER_CONSTRAINTS } from '@/lib/permission-groups/types'
import { isOrganizationMember } from '@/lib/workspaces/permissions/utils'
import {
  authorizeOrgAccessControl,
  loadGroupInOrganization,
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
        const existingInOrganization = await tx
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
              eq(permissionGroup.organizationId, organizationId)
            )
          )

        if (existingInOrganization.some((row) => row.permissionGroupId === id)) {
          throw new Error('ALREADY_IN_GROUP')
        }

        if (existingInOrganization.length > 0) {
          await tx.delete(permissionGroupMember).where(
            inArray(
              permissionGroupMember.id,
              existingInOrganization.map((row) => row.id)
            )
          )
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
      if (error instanceof Error && error.message === 'ALREADY_IN_GROUP') {
        return NextResponse.json(
          { error: 'User is already in this permission group' },
          { status: 409 }
        )
      }
      if (getPostgresErrorCode(error) === '23505') {
        const constraint = getPostgresConstraintName(error)
        if (constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.organizationUser) {
          return NextResponse.json(
            {
              error:
                'User was concurrently added to another group in this organization. Please refresh and try again.',
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

    const { id: organizationId, groupId: id } = await params
    const { searchParams } = new URL(req.url)
    const memberId = searchParams.get('memberId')

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    try {
      const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
      if (denied) return denied

      const group = await loadGroupInOrganization(id, organizationId)
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
      logger.error('Error removing member from permission group', error)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }
  }
)
