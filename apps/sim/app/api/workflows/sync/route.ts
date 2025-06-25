import crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workspace, workspaceMember } from '@/db/schema'

const logger = createLogger('WorkflowAPI')

// Cache for workspace membership to reduce DB queries
const workspaceMembershipCache = new Map<string, { role: string; expires: number }>()
const CACHE_TTL = 60000 // 1 minute cache expiration
const MAX_CACHE_SIZE = 1000 // Maximum number of entries to prevent unbounded growth

/**
 * Cleans up expired entries from the workspace membership cache
 */
function cleanupExpiredCacheEntries(): void {
  const now = Date.now()
  let expiredCount = 0

  // Remove expired entries
  for (const [key, value] of workspaceMembershipCache.entries()) {
    if (value.expires <= now) {
      workspaceMembershipCache.delete(key)
      expiredCount++
    }
  }

  // If we're still over the limit after removing expired entries,
  // remove the oldest entries (those that will expire soonest)
  if (workspaceMembershipCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(workspaceMembershipCache.entries()).sort(
      (a, b) => a[1].expires - b[1].expires
    )

    const toRemove = entries.slice(0, workspaceMembershipCache.size - MAX_CACHE_SIZE)
    toRemove.forEach(([key]) => workspaceMembershipCache.delete(key))

    logger.debug(
      `Cache cleanup: removed ${expiredCount} expired entries and ${toRemove.length} additional entries due to size limit`
    )
  } else if (expiredCount > 0) {
    logger.debug(`Cache cleanup: removed ${expiredCount} expired entries`)
  }
}

/**
 * Efficiently verifies user's membership and role in a workspace with caching
 * @param userId User ID to check
 * @param workspaceId Workspace ID to check
 * @returns Role if user is a member, null otherwise
 */
async function verifyWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  // Opportunistic cleanup of expired cache entries
  if (workspaceMembershipCache.size > MAX_CACHE_SIZE / 2) {
    cleanupExpiredCacheEntries()
  }

  // Create cache key from userId and workspaceId
  const cacheKey = `${userId}:${workspaceId}`

  // Check cache first
  const cached = workspaceMembershipCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return cached.role
  }

  // If not in cache or expired, query the database
  try {
    const membership = await db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
      .then((rows) => rows[0])

    if (!membership) {
      return null
    }

    // Cache the result
    workspaceMembershipCache.set(cacheKey, {
      role: membership.role,
      expires: Date.now() + CACHE_TTL,
    })

    return membership.role
  } catch (error) {
    logger.error(`Error verifying workspace membership for ${userId} in ${workspaceId}:`, error)
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
