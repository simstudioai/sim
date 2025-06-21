import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workspaceMember } from '@/db/schema'

// DELETE /api/workspaces/members/[id] - Remove a member from a workspace
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membershipId = id

  try {
    // Get the membership to delete
    const membership = await db
      .select({
        id: workspaceMember.id,
        workspaceId: workspaceMember.workspaceId,
        userId: workspaceMember.userId,
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .where(eq(workspaceMember.id, membershipId))
      .then((rows) => rows[0])

    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    // Check if current user is an owner of the workspace or the member being removed
    const isOwner = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, membership.workspaceId),
          eq(workspaceMember.userId, session.user.id),
          eq(workspaceMember.role, 'owner')
        )
      )
      .then((rows) => rows.length > 0)

    const isSelf = membership.userId === session.user.id

    if (!isOwner && !isSelf) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Prevent removing yourself if you're the owner and the last owner
    if (isSelf && membership.role === 'owner') {
      const otherOwners = await db
        .select()
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, membership.workspaceId),
            eq(workspaceMember.role, 'owner')
          )
        )
        .then((rows) => rows.filter((row) => row.userId !== session.user.id))

      if (otherOwners.length === 0) {
        return NextResponse.json(
          { error: 'Cannot remove the last owner from a workspace' },
          { status: 400 }
        )
      }
    }

    // Delete the membership
    await db.delete(workspaceMember).where(eq(workspaceMember.id, membershipId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing workspace member:', error)
    return NextResponse.json({ error: 'Failed to remove workspace member' }, { status: 500 })
  }
}
