import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { folder as folderTable, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isFolderInWorkspace } from '@sim/platform-authz/workflow'
import { getPostgresConstraintName, getPostgresErrorCode, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import type { DbOrTx } from '@/lib/db/types'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { archiveWorkflow, restoreWorkflow } from '@/lib/workflows/lifecycle'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { nextWorkflowSortOrder } from '@/lib/workflows/sort-order'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowLifecycle')

/** Partial unique index on `(workspace_id, coalesce(folder_id, ''), name) WHERE archived_at IS NULL`. */
const WORKFLOW_NAME_UNIQUE_INDEX = 'workflow_workspace_folder_name_active_unique'
const WORKFLOW_NAME_DEDUPLICATION_ATTEMPTS = 8

export interface PerformCreateWorkflowParams {
  userId: string
  workspaceId: string
  name: string
  id?: string
  description?: string | null
  folderId?: string | null
  sortOrder?: number
  deduplicate?: boolean
  requestId?: string
}

export interface PerformCreateWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  workflow?: {
    id: string
    name: string
    description?: string | null
    workspaceId: string
    folderId?: string | null
    sortOrder: number
    createdAt: Date
    updatedAt: Date
    startBlockId?: string
    subBlockValues: Record<string, unknown>
  }
}

export interface PerformUpdateWorkflowParams {
  workflowId: string
  userId: string
  workspaceId: string
  currentName: string
  currentFolderId?: string | null
  /** Prior `locked` value, used to detect lock-state transitions for instrumentation. */
  currentLocked?: boolean | null
  /** Prior `forkSyncExcluded` value, used to detect exclusion transitions for instrumentation. */
  currentForkSyncExcluded?: boolean | null
  name?: string
  description?: string | null
  folderId?: string | null
  sortOrder?: number
  locked?: boolean
  forkSyncExcluded?: boolean
  requestId?: string
  tx?: DbOrTx
}

export interface PerformUpdateWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  workflow?: {
    id: string
    name: string
    description: string | null
    workspaceId: string | null
    folderId: string | null
    sortOrder: number | null
    locked: boolean | null
    forkSyncExcluded: boolean | null
    createdAt: Date
    updatedAt: Date
    archivedAt: Date | null
  }
}

export interface PerformDeleteWorkflowParams {
  workflowId: string
  userId: string
  requestId?: string
  /** When true, allows deleting the last workflow in a workspace (used by admin API). */
  skipLastWorkflowGuard?: boolean
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
  /** Legacy lifecycle notification; application commands project their own semantic event. */
  notifySocket?: boolean
}

export interface PerformDeleteWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  archived?: boolean
  workflow?: {
    id: string
    name: string
    workspaceId: string | null
  }
}

export interface PerformRestoreWorkflowParams {
  workflowId: string
  userId: string
  requestId?: string
}

export interface PerformRestoreWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  workflow?: Awaited<ReturnType<typeof restoreWorkflow>>['workflow']
}

async function workflowNameExistsInFolder(params: {
  workspaceId: string
  name: string
  folderId?: string | null
  excludeWorkflowId?: string
  tx?: DbOrTx
}): Promise<boolean> {
  const executor = params.tx ?? db
  const conditions = [
    eq(workflow.workspaceId, params.workspaceId),
    isNull(workflow.archivedAt),
    eq(workflow.name, params.name),
  ]

  if (params.excludeWorkflowId) {
    conditions.push(ne(workflow.id, params.excludeWorkflowId))
  }

  if (params.folderId) {
    conditions.push(eq(workflow.folderId, params.folderId))
  } else {
    conditions.push(isNull(workflow.folderId))
  }

  const [duplicateWorkflow] = await executor
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(...conditions))
    .limit(1)
  return Boolean(duplicateWorkflow)
}

async function isWorkflowFolderInWorkspace(
  folderId: string | null | undefined,
  workspaceId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  if (!folderId) return true
  const [row] = await executor
    .select({ id: folderTable.id })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.id, folderId),
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, 'workflow'),
        isNull(folderTable.deletedAt)
      )
    )
    .limit(1)
  return Boolean(row)
}

export async function performCreateWorkflowTransition(
  params: PerformCreateWorkflowParams
): Promise<PerformCreateWorkflowResult> {
  const requestId = params.requestId ?? generateRequestId()
  const workflowId = params.id || generateId()
  const folderId = params.folderId || null

  if (!(await isFolderInWorkspace(folderId, params.workspaceId))) {
    return { success: false, error: 'Target folder not found', errorCode: 'validation' }
  }

  let name = params.name

  if (!params.deduplicate) {
    const duplicate = await workflowNameExistsInFolder({
      workspaceId: params.workspaceId,
      name,
      folderId,
    })
    if (duplicate) {
      return {
        success: false,
        error: `A workflow named "${name}" already exists in this folder`,
        errorCode: 'conflict',
      }
    }
  }

  const sortOrder =
    params.sortOrder !== undefined
      ? params.sortOrder
      : await nextWorkflowSortOrder(params.workspaceId, folderId)
  const now = new Date()
  const { workflowState, subBlockValues, startBlockId } = buildDefaultWorkflowArtifacts()

  const maxAttempts = params.deduplicate ? WORKFLOW_NAME_DEDUPLICATION_ATTEMPTS : 1
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (params.deduplicate) {
      name = await deduplicateWorkflowName(params.name, params.workspaceId, folderId)
    }

    try {
      await db.transaction(async (tx) => {
        await tx.insert(workflow).values({
          id: workflowId,
          userId: params.userId,
          workspaceId: params.workspaceId,
          folderId,
          sortOrder,
          name,
          description: params.description,
          lastSynced: now,
          createdAt: now,
          updatedAt: now,
          isDeployed: false,
          runCount: 0,
          variables: {},
        })

        await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
      })
      break
    } catch (error) {
      /**
       * Name selection is a `SELECT`, so a concurrent create can claim the candidate
       * before this transaction inserts it. Deduplicated creates retry against the
       * newly committed names; exact-name creates keep returning the conflict the
       * pre-check reports. Matching the constraint avoids relabeling a `23505` from
       * normalized workflow tables as a name collision.
       */
      const isNameConflict =
        getPostgresErrorCode(error) === '23505' &&
        getPostgresConstraintName(error) === WORKFLOW_NAME_UNIQUE_INDEX
      if (!isNameConflict) {
        throw error
      }

      if (!params.deduplicate || attempt === maxAttempts - 1) {
        return {
          success: false,
          error: `A workflow named "${name}" already exists in this folder`,
          errorCode: 'conflict',
        }
      }

      logger.warn(`[${requestId}] Workflow name was claimed during creation; retrying`, {
        name,
        attempt: attempt + 1,
      })
    }
  }

  logger.info(`[${requestId}] Successfully created workflow ${workflowId}`)

  return {
    success: true,
    workflow: {
      id: workflowId,
      name,
      description: params.description,
      workspaceId: params.workspaceId,
      folderId,
      sortOrder,
      createdAt: now,
      updatedAt: now,
      startBlockId,
      subBlockValues,
    },
  }
}

export async function performCreateWorkflow(
  params: PerformCreateWorkflowParams
): Promise<PerformCreateWorkflowResult> {
  const requestId = params.requestId ?? generateRequestId()
  try {
    const result = await performCreateWorkflowTransition({ ...params, requestId })
    if (result.success && result.workflow) {
      recordAudit({
        workspaceId: params.workspaceId,
        actorId: params.userId,
        action: AuditAction.WORKFLOW_CREATED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: result.workflow.id,
        resourceName: result.workflow.name,
        description: `Created workflow "${result.workflow.name}"`,
        metadata: {
          name: result.workflow.name,
          description: params.description || undefined,
          workspaceId: params.workspaceId,
          folderId: result.workflow.folderId || undefined,
          sortOrder: result.workflow.sortOrder,
        },
      })
    }
    return result
  } catch (error) {
    logger.error(`[${requestId}] Failed to create workflow`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function updateWorkflowRecord(
  params: PerformUpdateWorkflowParams
): Promise<PerformUpdateWorkflowResult> {
  const executor = params.tx ?? db
  const requestId = params.requestId ?? generateRequestId()
  const targetName = params.name ?? params.currentName
  const targetFolderId =
    params.folderId !== undefined ? params.folderId || null : params.currentFolderId || null

  if (
    params.folderId !== undefined &&
    !(await isWorkflowFolderInWorkspace(targetFolderId, params.workspaceId, executor))
  ) {
    return { success: false, error: 'Target folder not found', errorCode: 'validation' }
  }

  if (params.name !== undefined || params.folderId !== undefined) {
    const duplicate = await workflowNameExistsInFolder({
      workspaceId: params.workspaceId,
      name: targetName,
      folderId: targetFolderId,
      excludeWorkflowId: params.workflowId,
      tx: executor,
    })
    if (duplicate) {
      return {
        success: false,
        error: `A workflow named "${targetName}" already exists in this folder`,
        errorCode: 'conflict',
      }
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (params.name !== undefined) updateData.name = params.name
  if (params.description !== undefined) updateData.description = params.description
  if (params.folderId !== undefined) updateData.folderId = params.folderId
  if (params.sortOrder !== undefined) updateData.sortOrder = params.sortOrder
  if (params.locked !== undefined) updateData.locked = params.locked
  if (params.forkSyncExcluded !== undefined) updateData.forkSyncExcluded = params.forkSyncExcluded

  const [updatedWorkflow] = await executor
    .update(workflow)
    .set(updateData)
    .where(
      and(
        eq(workflow.id, params.workflowId),
        eq(workflow.workspaceId, params.workspaceId),
        isNull(workflow.archivedAt)
      )
    )
    .returning({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      workspaceId: workflow.workspaceId,
      folderId: workflow.folderId,
      sortOrder: workflow.sortOrder,
      locked: workflow.locked,
      forkSyncExcluded: workflow.forkSyncExcluded,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      archivedAt: workflow.archivedAt,
    })

  if (!updatedWorkflow) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  logger.info(`[${requestId}] Successfully updated workflow ${params.workflowId}`, {
    updates: updateData,
  })

  return { success: true, workflow: updatedWorkflow }
}

export async function deleteWorkflowRecord(
  params: PerformDeleteWorkflowParams
): Promise<PerformDeleteWorkflowResult> {
  const { workflowId, skipLastWorkflowGuard = false } = params
  const requestId = params.requestId ?? generateRequestId()

  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  if (!skipLastWorkflowGuard && workflowRecord.workspaceId) {
    const totalWorkflows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workflowRecord.workspaceId), isNull(workflow.archivedAt)))

    if (totalWorkflows.length <= 1) {
      return {
        success: false,
        error: 'Cannot delete the only workflow in the workspace',
        errorCode: 'validation',
      }
    }
  }

  const archiveResult = await archiveWorkflow(workflowId, {
    requestId,
    notifySocket: params.notifySocket,
  })
  if (!archiveResult.workflow) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  logger.info(`[${requestId}] Successfully archived workflow ${workflowId}`)
  return {
    success: true,
    archived: archiveResult.archived,
    workflow: {
      id: archiveResult.workflow.id,
      name: archiveResult.workflow.name,
      workspaceId: archiveResult.workflow.workspaceId,
    },
  }
}

/**
 * Performs a full workflow deletion: enforces the last-workflow guard,
 * archives the workflow via `archiveWorkflow`, and records an audit entry.
 * Both the workflow API DELETE handler and the copilot delete_workflow tool
 * must use this function.
 */
export async function performDeleteWorkflow(
  params: PerformDeleteWorkflowParams
): Promise<PerformDeleteWorkflowResult> {
  const { workflowId, userId } = params
  const actorId = params.actorId ?? userId
  const result = await deleteWorkflowRecord(params)
  if (!result.success || !result.archived || !result.workflow) return result

  recordAudit({
    workspaceId: result.workflow.workspaceId || null,
    actorId,
    action: AuditAction.WORKFLOW_DELETED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: result.workflow.name,
    description: `Archived workflow "${result.workflow.name}"`,
    metadata: { archived: true },
  })

  return result
}

export async function performRestoreWorkflow(
  params: PerformRestoreWorkflowParams
): Promise<PerformRestoreWorkflowResult> {
  const { workflowId, userId } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    const restoreResult = await restoreWorkflow(workflowId, { requestId })
    if (!restoreResult.workflow) {
      return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
    }
    if (!restoreResult.restored) {
      return {
        success: false,
        error: 'Workflow is not archived',
        errorCode: 'validation',
        workflow: restoreResult.workflow,
      }
    }

    logger.info(`[${requestId}] Successfully restored workflow ${workflowId}`)

    recordAudit({
      workspaceId: restoreResult.workflow.workspaceId || null,
      actorId: userId,
      action: AuditAction.WORKFLOW_RESTORED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: workflowId,
      resourceName: restoreResult.workflow.name,
      description: `Restored workflow "${restoreResult.workflow.name}"`,
      metadata: {
        workflowName: restoreResult.workflow.name,
        workspaceId: restoreResult.workflow.workspaceId || undefined,
      },
    })

    return { success: true, workflow: restoreResult.workflow }
  } catch (error) {
    logger.error(`[${requestId}] Failed to restore workflow ${workflowId}`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
