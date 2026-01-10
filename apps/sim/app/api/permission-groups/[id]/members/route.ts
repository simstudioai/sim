import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasAccessControlAccess } from '@/lib/billing'

const logger = createLogger('PermissionGroupMembers')

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const result = await getPermissionGroupWithAccess(id, session.user.id)

  if (!result) {
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

const addMemberSchema = z.object({
  userId: z.string().min(1),
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
    const { userId } = addMemberSchema.parse(body)

    const [orgMember] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, result.group.organizationId)))
      .limit(1)

    if (!orgMember) {
      return NextResponse.json(
        { error: 'User is not a member of this organization' },
        { status: 400 }
      )
    }

    const [existingMembership] = await db
      .select({
        id: permissionGroupMember.id,
        permissionGroupId: permissionGroupMember.permissionGroupId,
      })
      .from(permissionGroupMember)
      .where(eq(permissionGroupMember.userId, userId))
      .limit(1)

    if (existingMembership?.permissionGroupId === id) {
      return NextResponse.json(
        { error: 'User is already in this permission group' },
        { status: 409 }
      )
    }

    const newMember = await db.transaction(async (tx) => {
      if (existingMembership) {
        await tx
          .delete(permissionGroupMember)
          .where(eq(permissionGroupMember.id, existingMembership.id))
      }

      const memberData = {
        id: crypto.randomUUID(),
        permissionGroupId: id,
        userId,
        assignedBy: session.user.id,
        assignedAt: new Date(),
      }

      await tx.insert(permissionGroupMember).values(memberData)
      return memberData
    })

    logger.info('Added member to permission group', {
      permissionGroupId: id,
      userId,
      assignedBy: session.user.id,
    })

    return NextResponse.json({ member: newMember }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    if (
      error instanceof Error &&
      error.message.includes('permission_group_member_user_id_unique')
    ) {
      return NextResponse.json({ error: 'User is already in a permission group' }, { status: 409 })
    }
    logger.error('Error adding member to permission group', error)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const memberId = searchParams.get('memberId')

  if (!memberId) {
    return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
  }

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

    const [memberToRemove] = await db
      .select()
      .from(permissionGroupMember)
      .where(
        and(eq(permissionGroupMember.id, memberId), eq(permissionGroupMember.permissionGroupId, id))
      )
      .limit(1)

    if (!memberToRemove) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    await db.delete(permissionGroupMember).where(eq(permissionGroupMember.id, memberId))

    logger.info('Removed member from permission group', {
      permissionGroupId: id,
      memberId,
      userId: session.user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing member from permission group', error)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
