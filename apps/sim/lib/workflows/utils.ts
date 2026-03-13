import crypto from 'crypto'
import { db } from '@sim/db'
import { permissions, userStats, workflowFolder, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, isNull, max, min, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getActiveWorkflowContext } from '@/lib/workflows/active-context'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowUtils')

export type WorkflowScope = 'active' | 'archived' | 'all'

export async function getWorkflowById(id: string, options?: { includeArchived?: boolean }) {
  const { includeArchived = false } = options ?? {}
  const rows = await db
    .select()
    .from(workflowTable)
    .where(
      includeArchived
        ? eq(workflowTable.id, id)
        : and(eq(workflowTable.id, id), isNull(workflowTable.archivedAt))
    )
    .limit(1)

  return rows[0]
}

export async function listWorkflows(workspaceId: string, options?: { scope?: WorkflowScope }) {
  const { scope = 'active' } = options ?? {}
  return db
    .select()
    .from(workflowTable)
    .where(
      scope === 'all'
        ? eq(workflowTable.workspaceId, workspaceId)
        : scope === 'archived'
          ? and(
              eq(workflowTable.workspaceId, workspaceId),
              sql`${workflowTable.archivedAt} IS NOT NULL`
            )
          : and(eq(workflowTable.workspaceId, workspaceId), isNull(workflowTable.archivedAt))
    )
    .orderBy(asc(workflowTable.sortOrder), asc(workflowTable.createdAt))
}

/**
 * Generates a unique workflow name within a workspace+folder scope.
 * If the name already exists among active workflows, appends (2), (3), etc.
 */
export async function deduplicateWorkflowName(
  name: string,
  workspaceId: string,
  folderId: string | null | undefined
): Promise<string> {
  const folderCondition = folderId
    ? eq(workflowTable.folderId, folderId)
    : isNull(workflowTable.folderId)

  const [existing] = await db
    .select({ id: workflowTable.id })
    .from(workflowTable)
    .where(
      and(
        eq(workflowTable.workspaceId, workspaceId),
        folderCondition,
        eq(workflowTable.name, name),
        isNull(workflowTable.archivedAt)
      )
    )
    .limit(1)

  if (!existing) {
    return name
  }

  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`
    const [dup] = await db
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(
        and(
          eq(workflowTable.workspaceId, workspaceId),
          folderCondition,
          eq(workflowTable.name, candidate),
          isNull(workflowTable.archivedAt)
        )
      )
      .limit(1)

    if (!dup) {
      return candidate
    }
  }

  return `${name} (${crypto.randomUUID().slice(0, 6)})`
}

export async function resolveWorkflowIdForUser(
  userId: string,
  workflowId?: string,
  workflowName?: string,
  workspaceId?: string
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
  const allowedWorkspaceIds = workspaceId
    ? workspaceIdList.filter((candidateWorkspaceId) => candidateWorkspaceId === workspaceId)
    : workspaceIdList
  if (allowedWorkspaceIds.length === 0) {
    return null
  }

  const workflows = await db
    .select()
    .from(workflowTable)
    .where(
      and(inArray(workflowTable.workspaceId, allowedWorkspaceIds), isNull(workflowTable.archivedAt))
    )
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

  const activeContext = await getActiveWorkflowContext(workflowId)
  if (!activeContext) {
    return {
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: null,
      workspacePermission: null,
    }
  }

  const workflow = activeContext.workflow

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

// ── Workflow CRUD ──

export interface CreateWorkflowInput {
  userId: string
  workspaceId: string
  name: string
  description?: string | null
  color?: string
  folderId?: string | null
}

export async function createWorkflowRecord(params: CreateWorkflowInput) {
  const {
    userId,
    workspaceId,
    name,
    description = null,
    color = getNextWorkflowColor(),
    folderId = null,
  } = params
  const workflowId = crypto.randomUUID()
  const now = new Date()

  const workflowParentCondition = folderId
    ? eq(workflowTable.folderId, folderId)
    : isNull(workflowTable.folderId)
  const folderParentCondition = folderId
    ? eq(workflowFolder.parentId, folderId)
    : isNull(workflowFolder.parentId)

  const [[workflowMinResult], [folderMinResult]] = await Promise.all([
    db
      .select({ minOrder: min(workflowTable.sortOrder) })
      .from(workflowTable)
      .where(
        and(
          eq(workflowTable.workspaceId, workspaceId),
          workflowParentCondition,
          isNull(workflowTable.archivedAt)
        )
      ),
    db
      .select({ minOrder: min(workflowFolder.sortOrder) })
      .from(workflowFolder)
      .where(and(eq(workflowFolder.workspaceId, workspaceId), folderParentCondition)),
  ])

  const minSortOrder = [workflowMinResult?.minOrder, folderMinResult?.minOrder].reduce<
    number | null
  >((currentMin, candidate) => {
    if (candidate == null) return currentMin
    if (currentMin == null) return candidate
    return Math.min(currentMin, candidate)
  }, null)

  const sortOrder = minSortOrder != null ? minSortOrder - 1 : 0

  await db.insert(workflowTable).values({
    id: workflowId,
    userId,
    workspaceId,
    folderId,
    sortOrder,
    name,
    description,
    color,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    isDeployed: false,
    runCount: 0,
    variables: {},
  })

  const { workflowState } = buildDefaultWorkflowArtifacts()
  const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)
  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to save workflow state')
  }

  return { workflowId, name, workspaceId, folderId, sortOrder, createdAt: now, updatedAt: now }
}

export async function updateWorkflowRecord(
  workflowId: string,
  updates: { name?: string; description?: string; color?: string; folderId?: string | null }
) {
  const setData: Record<string, unknown> = { updatedAt: new Date() }
  if (updates.name !== undefined) setData.name = updates.name
  if (updates.description !== undefined) setData.description = updates.description
  if (updates.color !== undefined) setData.color = updates.color
  if (updates.folderId !== undefined) setData.folderId = updates.folderId
  await db.update(workflowTable).set(setData).where(eq(workflowTable.id, workflowId))
}

export async function deleteWorkflowRecord(workflowId: string) {
  const { archiveWorkflow } = await import('@/lib/workflows/lifecycle')
  await archiveWorkflow(workflowId, {
    requestId: `workflow-record-${workflowId}`,
    notifySocket: false,
  })
}

export async function setWorkflowVariables(workflowId: string, variables: Record<string, unknown>) {
  await db
    .update(workflowTable)
    .set({ variables, updatedAt: new Date() })
    .where(eq(workflowTable.id, workflowId))
}

// ── Folder CRUD ──

export interface CreateFolderInput {
  userId: string
  workspaceId: string
  name: string
  parentId?: string | null
}

export async function createFolderRecord(params: CreateFolderInput) {
  const { userId, workspaceId, name, parentId = null } = params

  const [maxResult] = await db
    .select({ maxOrder: max(workflowFolder.sortOrder) })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.workspaceId, workspaceId),
        parentId ? eq(workflowFolder.parentId, parentId) : isNull(workflowFolder.parentId)
      )
    )
  const sortOrder = (maxResult?.maxOrder ?? 0) + 1

  const folderId = crypto.randomUUID()
  await db.insert(workflowFolder).values({
    id: folderId,
    userId,
    workspaceId,
    parentId,
    name,
    sortOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return { folderId, name, workspaceId, parentId }
}

export async function updateFolderRecord(
  folderId: string,
  updates: { name?: string; parentId?: string | null }
) {
  const setData: Record<string, unknown> = { updatedAt: new Date() }
  if (updates.name !== undefined) setData.name = updates.name
  if (updates.parentId !== undefined) setData.parentId = updates.parentId
  await db.update(workflowFolder).set(setData).where(eq(workflowFolder.id, folderId))
}

export async function deleteFolderRecord(folderId: string): Promise<boolean> {
  const [folder] = await db
    .select({ parentId: workflowFolder.parentId })
    .from(workflowFolder)
    .where(eq(workflowFolder.id, folderId))
    .limit(1)

  if (!folder) return false

  await db
    .update(workflowTable)
    .set({ folderId: folder.parentId, updatedAt: new Date() })
    .where(eq(workflowTable.folderId, folderId))

  await db
    .update(workflowFolder)
    .set({ parentId: folder.parentId, updatedAt: new Date() })
    .where(eq(workflowFolder.parentId, folderId))

  await db.delete(workflowFolder).where(eq(workflowFolder.id, folderId))

  return true
}

export async function listFolders(workspaceId: string) {
  return db
    .select({
      folderId: workflowFolder.id,
      folderName: workflowFolder.name,
      parentId: workflowFolder.parentId,
      sortOrder: workflowFolder.sortOrder,
    })
    .from(workflowFolder)
    .where(eq(workflowFolder.workspaceId, workspaceId))
    .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))
}
