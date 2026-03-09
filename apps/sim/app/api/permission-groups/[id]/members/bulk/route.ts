import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasAccessControlAccess } from '@/lib/billing'

const logger = createLogger('PermissionGroupBulkMembers')

async function getPermissionGroupWithAccess(groupId: string, userId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      organizationId: permissionGroup.organizationId,
    })
    .from(permissionGroup)
    .where(eq(permissionGroup.id, groupId))
    .limit(1)

  if (!group) return null

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, group.organizationId)))
    .limit(1)

  if (!membership) return null

  return { group, role: membership.role }
}

const bulkAddSchema = z.object({
  userIds: z.array(z.string()).optional(),
  addAllOrgMembers: z.boolean().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const hasAccess = await hasAccessControlAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access Control is an Enterprise feature' },
        { status: 403 }
      )
    }

    const result = await getPermissionGroupWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const body = await req.json()
    const { userIds, addAllOrgMembers } = bulkAddSchema.parse(body)

    let targetUserIds: string[] = []

    if (addAllOrgMembers) {
      const orgMembers = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, result.group.organizationId))

      targetUserIds = orgMembers.map((m) => m.userId)
    } else if (userIds && userIds.length > 0) {
      const validMembers = await db
        .select({ userId: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, result.group.organizationId),
            inArray(member.userId, userIds)
          )
        )

      targetUserIds = validMembers.map((m) => m.userId)
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({ added: 0, moved: 0 })
    }

    const existingMemberships = await db
      .select({
        id: permissionGroupMember.id,
        userId: permissionGroupMember.userId,
        permissionGroupId: permissionGroupMember.permissionGroupId,
      })
      .from(permissionGroupMember)
      .where(inArray(permissionGroupMember.userId, targetUserIds))

    const alreadyInThisGroup = new Set(
      existingMemberships.filter((m) => m.permissionGroupId === id).map((m) => m.userId)
    )
    const usersToAdd = targetUserIds.filter((uid) => !alreadyInThisGroup.has(uid))

    if (usersToAdd.length === 0) {
      return NextResponse.json({ added: 0, moved: 0 })
    }

    const membershipsToDelete = existingMemberships.filter(
      (m) => m.permissionGroupId !== id && usersToAdd.includes(m.userId)
    )
    const movedCount = membershipsToDelete.length

    await db.transaction(async (tx) => {
      if (membershipsToDelete.length > 0) {
        await tx.delete(permissionGroupMember).where(
          inArray(
            permissionGroupMember.id,
            membershipsToDelete.map((m) => m.id)
          )
        )
      }

      const newMembers = usersToAdd.map((userId) => ({
        id: crypto.randomUUID(),
        permissionGroupId: id,
        userId,
        assignedBy: session.user.id,
        assignedAt: new Date(),
      }))

      await tx.insert(permissionGroupMember).values(newMembers)
    })

    logger.info('Bulk added members to permission group', {
      permissionGroupId: id,
      addedCount: usersToAdd.length,
      movedCount,
      assignedBy: session.user.id,
    })

    return NextResponse.json({ added: usersToAdd.length, moved: movedCount })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    if (
      error instanceof Error &&
      error.message.includes('permission_group_member_user_id_unique')
    ) {
      return NextResponse.json(
        { error: 'One or more users are already in a permission group' },
        { status: 409 }
      )
    }
    logger.error('Error bulk adding members to permission group', error)
    return NextResponse.json({ error: 'Failed to add members' }, { status: 500 })
  }
}
