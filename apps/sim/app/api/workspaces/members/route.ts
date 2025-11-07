import { db } from '@sim/db'
import { permissions, user } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { hasAdminPermission } from '@/lib/permissions/utils'

const logger = createLogger('WorkspaceMemberAPI')

const addMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  userEmail: z.string().email(),
  permission: z.enum(['admin', 'write', 'read']).default('read'),
})

/**
 * Add a member to a workspace
 *
 * Note: This endpoint exists but is currently not used by the frontend.
 * The application uses the workspace invitations system instead:
 * - POST /api/workspaces/invitations - Send invitation email
 * - POST /api/workspaces/invitations/[invitationId] - Resend invitation
 * - DELETE /api/workspaces/invitations/[invitationId] - Cancel invitation
 *
 * This direct member addition endpoint could be used for:
 * - Programmatic member addition via API keys
 * - Internal admin tools
 * - Future UI implementations that skip the invitation flow
 */
export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { workspaceId, userEmail, permission } = addMemberSchema.parse(await req.json())

    // Check if current user has admin permission for the workspace
    const hasAdmin = await hasAdminPermission(session.user.id, workspaceId)

    if (!hasAdmin) {
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

    // Check if user already has permissions for this workspace
    const existingPermissions = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, targetUser.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )

    if (existingPermissions.length > 0) {
      return NextResponse.json(
        { error: 'User already has permissions for this workspace' },
        { status: 400 }
      )
    }

    // Create single permission for the new member
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      userId: targetUser.id,
      entityType: 'workspace' as const,
      entityId: workspaceId,
      permissionType: permission,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      message: `User added to workspace with ${permission} permission`,
    })
  } catch (error) {
    logger.error('Error adding workspace member:', error)
    return NextResponse.json({ error: 'Failed to add workspace member' }, { status: 500 })
  }
}
