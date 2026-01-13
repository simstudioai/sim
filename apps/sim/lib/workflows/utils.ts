import { db } from '@sim/db'
import { permissions, userStats, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getWorkspaceWithOwner, type PermissionType } from '@/lib/workspaces/permissions/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowUtils')

export async function getWorkflowById(id: string) {
  const rows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)

  return rows[0]
}

type WorkflowRecord = ReturnType<typeof getWorkflowById> extends Promise<infer R>
  ? NonNullable<R>
  : never

export interface WorkflowAccessContext {
  workflow: WorkflowRecord
  workspaceOwnerId: string | null
  workspacePermission: PermissionType | null
  isOwner: boolean
  isWorkspaceOwner: boolean
}

export async function getWorkflowAccessContext(
  workflowId: string,
  userId?: string
): Promise<WorkflowAccessContext | null> {
  const workflow = await getWorkflowById(workflowId)

  if (!workflow) {
    return null
  }

  let workspaceOwnerId: string | null = null
  let workspacePermission: PermissionType | null = null

  if (workflow.workspaceId) {
    const workspaceRow = await getWorkspaceWithOwner(workflow.workspaceId)

    workspaceOwnerId = workspaceRow?.ownerId ?? null

    if (userId) {
      const [permissionRow] = await db
        .select({ permissionType: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, userId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflow.workspaceId)
          )
        )
        .limit(1)

      workspacePermission = permissionRow?.permissionType ?? null
    }
  }

  const resolvedUserId = userId ?? null

  const isOwner = resolvedUserId ? workflow.userId === resolvedUserId : false
  const isWorkspaceOwner = resolvedUserId ? workspaceOwnerId === resolvedUserId : false

  return {
    workflow,
    workspaceOwnerId,
    workspacePermission,
    isOwner,
    isWorkspaceOwner,
  }
}

export async function updateWorkflowRunCounts(workflowId: string, runs = 1) {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    await db
      .update(workflowTable)
      .set({
        runCount: workflow.runCount + runs,
        lastRunAt: new Date(),
      })
      .where(eq(workflowTable.id, workflowId))

    try {
      const existing = await db
        .select()
        .from(userStats)
        .where(eq(userStats.userId, workflow.userId))
        .limit(1)

      if (existing.length === 0) {
        logger.warn('User stats record not found - should be created during onboarding', {
          userId: workflow.userId,
          workflowId,
        })
      } else {
        await db
          .update(userStats)
          .set({
            lastActive: new Date(),
          })
          .where(eq(userStats.userId, workflow.userId))
      }
    } catch (error) {
      logger.error(`Error updating userStats lastActive for userId ${workflow.userId}:`, error)
      // Don't rethrow - we want to continue even if this fails
    }

    return {
      success: true,
      runsAdded: runs,
      newTotal: workflow.runCount + runs,
    }
  } catch (error) {
    logger.error(`Error updating workflow stats for ${workflowId}`, error)
    throw error
  }
}

export const workflowHasResponseBlock = (executionResult: ExecutionResult): boolean => {
  if (!executionResult?.logs || !Array.isArray(executionResult.logs) || !executionResult.success) {
    return false
  }

  const responseBlock = executionResult.logs.find(
    (log) => log?.blockType === 'response' && log?.success
  )

  return responseBlock !== undefined
}

export const createHttpResponseFromBlock = (executionResult: ExecutionResult): NextResponse => {
  const { data = {}, status = 200, headers = {} } = executionResult.output

  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return NextResponse.json(data, {
    status: status,
    headers: responseHeaders,
  })
}

/**
 * Validates that the current user has permission to access/modify a workflow
 * Returns session and workflow info if authorized, or error response if not
 */
export async function validateWorkflowPermissions(
  workflowId: string,
  requestId: string,
  action: 'read' | 'write' | 'admin' = 'read'
) {
  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] No authenticated user session for workflow ${action}`)
    return {
      error: { message: 'Unauthorized', status: 401 },
      session: null,
      workflow: null,
    }
  }

  const accessContext = await getWorkflowAccessContext(workflowId, session.user.id)
  if (!accessContext) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
    return {
      error: { message: 'Workflow not found', status: 404 },
      session: null,
      workflow: null,
    }
  }

  const { workflow, workspacePermission, isOwner } = accessContext

  if (isOwner) {
    return {
      error: null,
      session,
      workflow,
    }
  }

  if (workflow.workspaceId) {
    let hasPermission = false

    if (action === 'read') {
      // Any workspace permission allows read
      hasPermission = workspacePermission !== null
    } else if (action === 'write') {
      // Write or admin permission allows write
      hasPermission = workspacePermission === 'write' || workspacePermission === 'admin'
    } else if (action === 'admin') {
      // Only admin permission allows admin actions
      hasPermission = workspacePermission === 'admin'
    }

    if (!hasPermission) {
      logger.warn(
        `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} in workspace ${workflow.workspaceId}`
      )
      return {
        error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
        session: null,
        workflow: null,
      }
    }
  } else {
    logger.warn(
      `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId} owned by ${workflow.userId}`
    )
    return {
      error: { message: `Unauthorized: Access denied to ${action} this workflow`, status: 403 },
      session: null,
      workflow: null,
    }
  }

  return {
    error: null,
    session,
    workflow,
  }
}
