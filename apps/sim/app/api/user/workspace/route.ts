import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { settings, workspaceMember } from '@/db/schema'

const logger = createLogger('WorkspaceAPI')

const WorkspaceRequestSchema = z.object({
  workspaceId: z.string(),
})

/**
 * GET /api/user/workspace
 * Retrieve user's last active workspace
 */
export async function GET() {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated workspace request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const userId = session.user.id

    // Get user's last active workspace from settings
    const userSettings = await db
      .select({ lastActiveWorkspaceId: settings.lastActiveWorkspaceId })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    if (!userSettings.length || !userSettings[0].lastActiveWorkspaceId) {
      // No workspace preference stored
      return NextResponse.json({ workspaceId: null }, { status: 200 })
    }

    const workspaceId = userSettings[0].lastActiveWorkspaceId

    // Verify user still has access to this workspace
    const hasAccess = await db
      .select({ workspaceId: workspaceMember.workspaceId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
      .limit(1)

    if (!hasAccess.length) {
      // User no longer has access to this workspace, clear the preference
      await db
        .update(settings)
        .set({ lastActiveWorkspaceId: null })
        .where(eq(settings.userId, userId))

      return NextResponse.json({ workspaceId: null }, { status: 200 })
    }

    return NextResponse.json({ workspaceId }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving workspace preference`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/user/workspace
 * Store user's active workspace preference
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated workspace update rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    // Validate request body
    const validationResult = WorkspaceRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid workspace request data`, {
        errors: validationResult.error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const { workspaceId } = validationResult.data

    // Verify workspace exists and user has access
    const hasAccess = await db
      .select({ workspaceId: workspaceMember.workspaceId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
      .limit(1)

    if (!hasAccess.length) {
      logger.warn(
        `[${requestId}] User ${userId} attempted to set workspace ${workspaceId} without access`
      )
      return NextResponse.json({ error: 'Access denied to workspace' }, { status: 403 })
    }

    // Update or create user settings with workspace preference
    await db
      .insert(settings)
      .values({
        id: userId, // Use user ID as settings ID
        userId,
        lastActiveWorkspaceId: workspaceId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [settings.userId],
        set: {
          lastActiveWorkspaceId: workspaceId,
          updatedAt: new Date(),
        },
      })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error updating workspace preference`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
