import { db } from '@sim/db'
import { permissions, userStats, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowUtils')

export async function getWorkflowById(id: string) {
  const rows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)

  return rows[0]
}

export async function resolveWorkflowIdForUser(
  userId: string,
  workflowId?: string,
  workflowName?: string
): Promise<{ workflowId: string; workflowName?: string } | null> {
  if (workflowId) {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      return null
    }
    const wf = await getWorkflowById(workflowId)
    return { workflowId, workflowName: wf?.name || undefined }
  }

  const workspaceIds = await db
    .select({ entityId: permissions.entityId })
    .from(permissions)
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))

  const workspaceIdList = workspaceIds.map((row) => row.entityId)
  if (workspaceIdList.length === 0) {
    return null
  }

  const workflows = await db
    .select()
    .from(workflowTable)
    .where(inArray(workflowTable.workspaceId, workspaceIdList))
    .orderBy(asc(workflowTable.sortOrder), asc(workflowTable.createdAt), asc(workflowTable.id))

  if (workflows.length === 0) {
    return null
  }

  if (workflowName) {
    const match = workflows.find(
      (w) =>
        String(w.name || '')
          .trim()
          .toLowerCase() === workflowName.toLowerCase()
    )
    if (match) {
      return { workflowId: match.id, workflowName: match.name || undefined }
    }
    return null
  }

  return { workflowId: workflows[0].id, workflowName: workflows[0].name || undefined }
}

type WorkflowRecord = ReturnType<typeof getWorkflowById> extends Promise<infer R>
  ? NonNullable<R>
  : never

export interface WorkflowWorkspaceAuthorizationResult {
  allowed: boolean
  status: number
  message?: string
  workflow: WorkflowRecord | null
  workspacePermission: PermissionType | null
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

    let activityUserId: string | null = null
    if (workflow.workspaceId) {
      try {
        activityUserId = await getWorkspaceBilledAccountUserId(workflow.workspaceId)
      } catch (error) {
        logger.warn(`Error resolving billed account for workspace ${workflow.workspaceId}`, {
          workflowId,
          error,
        })
      }
    }

    if (activityUserId) {
      try {
        const existing = await db
          .select()
          .from(userStats)
          .where(eq(userStats.userId, activityUserId))
          .limit(1)

        if (existing.length === 0) {
          logger.warn('User stats record not found - should be created during onboarding', {
            userId: activityUserId,
            workflowId,
          })
        } else {
          await db
            .update(userStats)
            .set({
              lastActive: new Date(),
            })
            .where(eq(userStats.userId, activityUserId))
        }
      } catch (error) {
        logger.error(`Error updating userStats lastActive for userId ${activityUserId}:`, error)
        // Don't rethrow - we want to continue even if this fails
      }
    } else {
      logger.warn(
        'Skipping userStats lastActive update: unable to resolve workspace billed account',
        {
          workflowId,
          workspaceId: workflow.workspaceId,
        }
      )
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

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: session.user.id,
    action,
  })

  if (!authorization.workflow) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
    return {
      error: { message: 'Workflow not found', status: 404 },
      session: null,
      workflow: null,
    }
  }

  if (!authorization.allowed) {
    const message =
      authorization.message || `Unauthorized: Access denied to ${action} this workflow`
    logger.warn(
      `[${requestId}] User ${session.user.id} unauthorized to ${action} workflow ${workflowId}`,
      {
        action,
        workflowId,
      }
    )
    return {
      error: { message, status: authorization.status },
      session: null,
      workflow: null,
    }
  }

  return {
    error: null,
    session,
    workflow: authorization.workflow,
  }
}

export async function authorizeWorkflowByWorkspacePermission(params: {
  workflowId: string
  userId: string
  action?: 'read' | 'write' | 'admin'
}): Promise<WorkflowWorkspaceAuthorizationResult> {
  const { workflowId, userId, action = 'read' } = params

  const workflow = await getWorkflowById(workflowId)
  if (!workflow) {
    return {
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
    }
  }

  if (!workflow.workspaceId) {
    return {
      allowed: false,
      status: 403,
      message:
        'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
      workflow,
      workspacePermission: null,
    }
  }

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

  const workspacePermission = permissionRow?.permissionType ?? null

  if (workspacePermission === null) {
    return {
      allowed: false,
      status: 403,
      message: `Unauthorized: Access denied to ${action} this workflow`,
      workflow,
      workspacePermission,
    }
  }

  const permissionSatisfied =
    action === 'read'
      ? true
      : action === 'write'
        ? workspacePermission === 'write' || workspacePermission === 'admin'
        : workspacePermission === 'admin'

  if (!permissionSatisfied) {
    return {
      allowed: false,
      status: 403,
      message: `Unauthorized: Access denied to ${action} this workflow`,
      workflow,
      workspacePermission,
    }
  }

  return {
    allowed: true,
    status: 200,
    workflow,
    workspacePermission,
  }
}
