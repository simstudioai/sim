import { db } from '@sim/db'
import { folder as workflowFolder, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, min, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ensureWorkflowAliasBacking } from '@/lib/copilot/vfs/workflow-alias-backing'
import { materializeInlineExecutionValue } from '@/lib/execution/payloads/inline-materialization.server'
import type { ExecutionMaterializationContext } from '@/lib/execution/payloads/materialization.server'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'
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
 *
 * Pass a transaction as `executor` when running inside an open tx so the
 * lookup observes workflows inserted earlier in the same transaction.
 */
export async function deduplicateWorkflowName(
  name: string,
  workspaceId: string,
  folderId: string | null | undefined,
  executor: Pick<typeof db, 'select'> = db
): Promise<string> {
  const folderCondition = folderId
    ? eq(workflowTable.folderId, folderId)
    : isNull(workflowTable.folderId)

  const [existing] = await executor
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
    const [dup] = await executor
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

  return `${name} (${generateId().slice(0, 6)})`
}

export type WorkflowResolutionResult =
  | {
      status: 'resolved'
      workflowId: string
      workspaceId: string
      workflowName?: string
    }
  | {
      status: 'not_found'
      message: string
    }
  | {
      status: 'ambiguous'
      message: string
      candidates: Array<{
        workflowId: string
        workflowName?: string
        folderId?: string | null
      }>
    }

export async function resolveWorkflowIdForUser(
  userId: string,
  workflowId?: string,
  workflowName?: string,
  workspaceId?: string
): Promise<WorkflowResolutionResult> {
  if (workflowId) {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      return {
        status: 'not_found',
        message: 'No workflows found. Create a workflow first or provide a valid workflowId.',
      }
    }
    const wf = await getWorkflowById(workflowId)
    if (!wf?.workspaceId) {
      return {
        status: 'not_found',
        message: 'No workflows found. Create a workflow first or provide a valid workflowId.',
      }
    }
    return {
      status: 'resolved',
      workflowId,
      workspaceId: wf.workspaceId,
      workflowName: wf.name || undefined,
    }
  }

  const accessibleRows = await listAccessibleWorkspaceRowsForUser(userId, 'all')
  const workspaceIdList = accessibleRows.map((row) => row.workspace.id)
  const allowedWorkspaceIds = workspaceId
    ? workspaceIdList.filter((candidateWorkspaceId) => candidateWorkspaceId === workspaceId)
    : workspaceIdList
  if (allowedWorkspaceIds.length === 0) {
    return {
      status: 'not_found',
      message: 'No workflows found. Create a workflow first or provide a valid workflowId.',
    }
  }

  const workflowRows = await db
    .select()
    .from(workflowTable)
    .where(
      and(inArray(workflowTable.workspaceId, allowedWorkspaceIds), isNull(workflowTable.archivedAt))
    )
    .orderBy(asc(workflowTable.sortOrder), asc(workflowTable.createdAt), asc(workflowTable.id))

  const workflows = workflowRows.filter(
    (workflow): workflow is (typeof workflowRows)[number] & { workspaceId: string } =>
      workflow.workspaceId !== null
  )

  if (workflows.length === 0) {
    return {
      status: 'not_found',
      message: 'No workflows found. Create a workflow first or provide a valid workflowId.',
    }
  }

  if (workflowName) {
    const matches = workflows.filter(
      (w) =>
        String(w.name || '')
          .trim()
          .toLowerCase() === workflowName.toLowerCase()
    )
    if (matches.length === 1) {
      const [match] = matches
      return {
        status: 'resolved',
        workflowId: match.id,
        workspaceId: match.workspaceId,
        workflowName: match.name || undefined,
      }
    }
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        message: `Multiple workflows named "${workflowName}" were found. Provide workflowId to disambiguate.`,
        candidates: matches.map((match) => ({
          workflowId: match.id,
          workflowName: match.name || undefined,
          folderId: match.folderId,
        })),
      }
    }
    return {
      status: 'not_found',
      message: `No workflow named "${workflowName}" was found.`,
    }
  }

  if (workflows.length === 1) {
    return {
      status: 'resolved',
      workflowId: workflows[0].id,
      workspaceId: workflows[0].workspaceId,
      workflowName: workflows[0].name || undefined,
    }
  }

  return {
    status: 'ambiguous',
    message:
      'Multiple workflows are available. Provide workflowId or workflowName to disambiguate.',
    candidates: workflows.slice(0, 20).map((workflow) => ({
      workflowId: workflow.id,
      workflowName: workflow.name || undefined,
      folderId: workflow.folderId,
    })),
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

export const workflowHasResponseBlock = (
  executionResult: Pick<ExecutionResult, 'success' | 'logs'>
): boolean => {
  if (!executionResult?.logs || !Array.isArray(executionResult.logs) || !executionResult.success) {
    return false
  }

  const responseBlock = executionResult.logs.find(
    (log) => log?.blockType === 'response' && log?.success
  )

  return responseBlock !== undefined
}

export const createHttpResponseFromBlock = async (
  executionResult: Pick<ExecutionResult, 'output'>,
  context?: ExecutionMaterializationContext
): Promise<NextResponse> => {
  const { data = {}, status = 200, headers = {} } = executionResult.output
  const responseData = await materializeInlineExecutionValue(data, context)

  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return NextResponse.json(responseData, {
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

// ── Workflow CRUD ──

export interface CreateWorkflowInput {
  userId: string
  workspaceId: string
  name: string
  description?: string | null
  folderId?: string | null
}

export async function createWorkflowRecord(params: CreateWorkflowInput) {
  const { userId, workspaceId, name, description = null, folderId = null } = params
  const workflowId = generateId()
  const now = new Date()

  const duplicateConditions = [
    eq(workflowTable.workspaceId, workspaceId),
    isNull(workflowTable.archivedAt),
    eq(workflowTable.name, name),
    ...(folderId ? [eq(workflowTable.folderId, folderId)] : [isNull(workflowTable.folderId)]),
  ]
  const [duplicateWorkflow] = await db
    .select({ id: workflowTable.id })
    .from(workflowTable)
    .where(and(...duplicateConditions))
    .limit(1)
  if (duplicateWorkflow) {
    throw new Error(
      `A workflow named "${name}" already exists in this folder. Use a different name.`
    )
  }

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
      .where(
        and(
          eq(workflowFolder.workspaceId, workspaceId),
          eq(workflowFolder.resourceType, 'workflow'),
          folderParentCondition
        )
      ),
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

  await ensureWorkflowAliasBacking({ workspaceId, userId, workflowId, workflowName: name })

  return { workflowId, name, workspaceId, folderId, sortOrder, createdAt: now, updatedAt: now }
}

export async function updateWorkflowRecord(
  workflowId: string,
  updates: { name?: string; description?: string; folderId?: string | null }
) {
  const setData: Record<string, unknown> = { updatedAt: new Date() }
  if (updates.name !== undefined) setData.name = updates.name
  if (updates.description !== undefined) setData.description = updates.description
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

export async function verifyFolderWorkspace(
  folderId: string,
  workspaceId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: workflowFolder.id })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.id, folderId),
        eq(workflowFolder.workspaceId, workspaceId),
        eq(workflowFolder.resourceType, 'workflow')
      )
    )
    .limit(1)
  return Boolean(row)
}

export async function listFolders(workspaceId: string) {
  return db
    .select({
      folderId: workflowFolder.id,
      folderName: workflowFolder.name,
      parentId: workflowFolder.parentId,
      sortOrder: workflowFolder.sortOrder,
      locked: workflowFolder.locked,
    })
    .from(workflowFolder)
    .where(
      and(
        eq(workflowFolder.workspaceId, workspaceId),
        eq(workflowFolder.resourceType, 'workflow'),
        isNull(workflowFolder.deletedAt)
      )
    )
    .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))
}
