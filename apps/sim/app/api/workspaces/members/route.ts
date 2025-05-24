import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { user, workspaceMember } from '@/db/schema'

// Add a member to a workspace
export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { workspaceId, userEmail, role = 'member' } = await req.json()

    if (!workspaceId || !userEmail) {
      return NextResponse.json(
        { error: 'Workspace ID and user email are required' },
        { status: 400 }
      )
    }

    // Check if current user is an owner or admin of the workspace
    const currentUserMembership = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, session.user.id)
        )
      )
      .then((rows) => rows[0])

    if (!currentUserMembership || currentUserMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Find user by email
    const targetUser = await db
      .select()
      .from(user)
      .where(eq(user.email, userEmail))
      .then((rows) => rows[0])

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if user is already a member
    const existingMembership = await db
      .select()
      .from(workspaceMember)
      .where(
        and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetUser.id))
      )
      .then((rows) => rows[0])

    if (existingMembership) {
      return NextResponse.json(
        { error: 'User is already a member of this workspace' },
        { status: 400 }
      )
    }

    // Add user to workspace
    await db.insert(workspaceMember).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId: targetUser.id,
      role,
      joinedAt: new Date(),
      updatedAt: new Date(),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error adding workspace member:', error)
    return NextResponse.json({ error: 'Failed to add workspace member' }, { status: 500 })
  }
}
