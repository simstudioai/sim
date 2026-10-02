import { db } from '@sim/db'
import { folder as folderTable, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { materializeInlineExecutionValue } from '@/lib/execution/payloads/inline-materialization.server'
import type { ExecutionMaterializationContext } from '@/lib/execution/payloads/materialization.server'
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

/**
 * Adds settled runs to a workflow's `runCount` and stamps `lastRunAt`. The
 * increment happens in SQL: concurrent runs of one workflow settle at the same
 * time, and a read-then-write would let one overwrite the other's count.
 */
export async function updateWorkflowRunCounts(workflowId: string, runs = 1) {
  try {
    const [updated] = await db
      .update(workflowTable)
      .set({
        runCount: sql`${workflowTable.runCount} + ${runs}`,
        lastRunAt: new Date(),
      })
      .where(eq(workflowTable.id, workflowId))
      .returning({ runCount: workflowTable.runCount })
    if (!updated) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    return {
      success: true,
      runsAdded: runs,
      newTotal: updated.runCount,
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

/** Headers that control the app origin or HTTP transport belong to the server. */
const RESERVED_RESPONSE_HEADERS = new Set([
  'accept-ch',
  'accept-ch-lifetime',
  'alt-svc',
  'clear-site-data',
  'connection',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-location',
  'content-range',
  'critical-ch',
  'document-policy',
  'keep-alive',
  'link',
  'location',
  'nel',
  'origin-agent-cluster',
  'permissions-policy',
  'proxy-authenticate',
  'public-key-pins',
  'public-key-pins-report-only',
  'referrer-policy',
  'refresh',
  'report-to',
  'reporting-endpoints',
  'set-cookie',
  'set-cookie2',
  'strict-transport-security',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'www-authenticate',
  'x-content-security-policy',
  'x-dns-prefetch-control',
  'x-download-options',
  'x-frame-options',
  'x-permitted-cross-domain-policies',
  'x-sendfile',
  'x-ua-compatible',
  'x-webkit-csp',
  'x-xss-protection',
])

const RESERVED_RESPONSE_HEADER_PREFIXES = [
  'access-control-',
  'content-security-policy',
  'cross-origin-',
  'sec-',
  'x-accel-',
  'x-middleware-',
] as const

export const createHttpResponseFromBlock = async (
  executionResult: Pick<ExecutionResult, 'output'>,
  context?: ExecutionMaterializationContext
): Promise<NextResponse> => {
  const { data = {}, status = 200, headers = {} } = executionResult.output
  const responseData = await materializeInlineExecutionValue(data, context)

  const responseHeaders = new Headers()
  for (const [name, value] of new Headers(headers)) {
    if (
      !RESERVED_RESPONSE_HEADERS.has(name) &&
      !RESERVED_RESPONSE_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      responseHeaders.set(name, value)
    }
  }

  // JSON serialization does not escape HTML; enforce the MIME type after normalizing header names.
  responseHeaders.set('Content-Type', 'application/json')
  responseHeaders.set('X-Content-Type-Options', 'nosniff')

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

export async function listFolders(workspaceId: string) {
  return db
    .select({
      folderId: folderTable.id,
      folderName: folderTable.name,
      parentId: folderTable.parentId,
      sortOrder: folderTable.sortOrder,
      locked: folderTable.locked,
    })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, 'workflow'),
        isNull(folderTable.deletedAt)
      )
    )
    .orderBy(asc(folderTable.sortOrder), asc(folderTable.createdAt))
}
