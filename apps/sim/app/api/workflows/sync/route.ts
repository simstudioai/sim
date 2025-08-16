import crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { workflow, workspace } from '@/db/schema'

const logger = createLogger('WorkflowAPI')

/**
 * Verifies user's workspace permissions using the permissions table
 * @param userId User ID to check
 * @param workspaceId Workspace ID to check
 * @returns Permission type if user has access, null otherwise
 */
async function verifyWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)

    return permission
  } catch (error) {
    logger.error(`Error verifying workspace permissions for ${userId} in ${workspaceId}:`, error)
    return null
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId')

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // If workspaceId is provided, verify it exists and user is a member
    if (workspaceId) {
      // Check workspace exists first
      const workspaceExists = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .then((rows) => rows.length > 0)

      if (!workspaceExists) {
        logger.warn(
          `[${requestId}] Attempt to fetch workflows for non-existent workspace: ${workspaceId}`
        )
        return NextResponse.json(
          { error: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' },
          { status: 404 }
        )
      }

      // Verify the user is a member of the workspace using our optimized function
      const userRole = await verifyWorkspaceMembership(userId, workspaceId)

      if (!userRole) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to access workspace ${workspaceId} without membership`
        )
        return NextResponse.json(
          { error: 'Access denied to this workspace', code: 'WORKSPACE_ACCESS_DENIED' },
          { status: 403 }
        )
      }

      // Migrate any orphaned workflows to this workspace (in background)
      migrateOrphanedWorkflows(userId, workspaceId).catch((error) => {
        logger.error(`[${requestId}] Error migrating orphaned workflows:`, error)
      })
    }

    // Fetch workflows for the user
    let workflows

    if (workspaceId) {
      // Filter by workspace ID only, not user ID
      // This allows sharing workflows across workspace members
      workflows = await db.select().from(workflow).where(eq(workflow.workspaceId, workspaceId))
    } else {
      // Filter by user ID only, including workflows without workspace IDs
      workflows = await db.select().from(workflow).where(eq(workflow.userId, userId))
    }

    const elapsed = Date.now() - startTime

    // Return the workflows
    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Workflow fetch error after ${elapsed}ms`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Helper function to migrate orphaned workflows to a workspace
async function migrateOrphanedWorkflows(userId: string, workspaceId: string) {
  try {
    // Find workflows without workspace IDs for this user
    const orphanedWorkflows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

    if (orphanedWorkflows.length === 0) {
      return // No orphaned workflows to migrate
    }

    logger.info(
      `Migrating ${orphanedWorkflows.length} orphaned workflows to workspace ${workspaceId}`
    )

    // Update workflows in batch if possible
    try {
      // Batch update all orphaned workflows
      await db
        .update(workflow)
        .set({
          workspaceId: workspaceId,
          updatedAt: new Date(),
        })
        .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

      logger.info(
        `Successfully migrated ${orphanedWorkflows.length} workflows to workspace ${workspaceId}`
      )
    } catch (batchError) {
      logger.warn('Batch migration failed, falling back to individual updates:', batchError)

      // Fallback to individual updates if batch update fails
      for (const { id } of orphanedWorkflows) {
        try {
          await db
            .update(workflow)
            .set({
              workspaceId: workspaceId,
              updatedAt: new Date(),
            })
            .where(eq(workflow.id, id))
        } catch (updateError) {
          logger.error(`Failed to migrate workflow ${id}:`, updateError)
        }
      }
    }
  } catch (error) {
    logger.error('Error migrating orphaned workflows:', error)
    // Continue execution even if migration fails
  }
}

// POST method removed - workflow operations now handled by:
// - POST /api/workflows (create)
// - DELETE /api/workflows/[id] (delete)
// - Socket.IO collaborative operations (real-time updates)
