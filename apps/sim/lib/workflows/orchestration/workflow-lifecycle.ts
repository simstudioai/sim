import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { templates, workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, min, ne } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { archiveWorkflow, restoreWorkflow } from '@/lib/workflows/lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowLifecycle')

export interface PerformCreateWorkflowParams {
  userId: string
  workspaceId: string
  name: string
  id?: string
  description?: string | null
  color?: string
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
    color?: string
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
  name?: string
  description?: string | null
  color?: string
  folderId?: string | null
  sortOrder?: number
  locked?: boolean
  requestId?: string
}

export interface PerformUpdateWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  workflow?: {
    id: string
    name: string
    description: string | null
    color: string | null
    workspaceId: string | null
    folderId: string | null
    sortOrder: number | null
    locked: boolean | null
    createdAt: Date
    updatedAt: Date
    archivedAt: Date | null
  }
}

export interface PerformDeleteWorkflowParams {
  workflowId: string
  userId: string
  requestId?: string
  /** When 'delete', delete published templates. When 'orphan' (default), set their workflowId to null. */
  templateAction?: 'delete' | 'orphan'
  /** When true, allows deleting the last workflow in a workspace (used by admin API). */
  skipLastWorkflowGuard?: boolean
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
}

export interface PerformDeleteWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
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

async function nextWorkflowSortOrder(
  workspaceId: string,
  folderId: string | null | undefined
): Promise<number> {
  const workflowParentCondition = folderId
    ? eq(workflow.folderId, folderId)
    : isNull(workflow.folderId)
  const folderParentCondition = folderId
    ? eq(workflowFolder.parentId, folderId)
    : isNull(workflowFolder.parentId)

  const [[workflowMinResult], [folderMinResult]] = await Promise.all([
    db
      .select({ minOrder: min(workflow.sortOrder) })
      .from(workflow)
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          workflowParentCondition,
          isNull(workflow.archivedAt)
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

  return minSortOrder != null ? minSortOrder - 1 : 0
}

async function workflowNameExistsInFolder(params: {
  workspaceId: string
  name: string
  folderId?: string | null
  excludeWorkflowId?: string
}): Promise<boolean> {
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

  const [duplicateWorkflow] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(...conditions))
    .limit(1)
  return Boolean(duplicateWorkflow)
}

export async function performCreateWorkflow(
  params: PerformCreateWorkflowParams
): Promise<PerformCreateWorkflowResult> {
  const requestId = params.requestId ?? generateRequestId()
  const workflowId = params.id || generateId()
  const folderId = params.folderId || null

  try {
    const name = params.deduplicate
      ? await deduplicateWorkflowName(params.name, params.workspaceId, folderId)
      : params.name

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

    await db.transaction(async (tx) => {
      await tx.insert(workflow).values({
        id: workflowId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        folderId,
        sortOrder,
        name,
        description: params.description,
        color: params.color,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        runCount: 0,
        variables: {},
      })

      await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
    })

    logger.info(`[${requestId}] Successfully created workflow ${workflowId}`)

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: workflowId,
      resourceName: name,
      description: `Created workflow "${name}"`,
      metadata: {
        name,
        description: params.description || undefined,
        color: params.color,
        workspaceId: params.workspaceId,
        folderId: folderId || undefined,
        sortOrder,
      },
    })

    return {
      success: true,
      workflow: {
        id: workflowId,
        name,
        description: params.description,
        color: params.color,
        workspaceId: params.workspaceId,
        folderId,
        sortOrder,
        createdAt: now,
        updatedAt: now,
        startBlockId,
        subBlockValues,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to create workflow`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performUpdateWorkflow(
  params: PerformUpdateWorkflowParams
): Promise<PerformUpdateWorkflowResult> {
  const requestId = params.requestId ?? generateRequestId()

  try {
    const targetName = params.name ?? params.currentName
    const targetFolderId =
      params.folderId !== undefined ? params.folderId || null : params.currentFolderId || null

    if (params.name !== undefined || params.folderId !== undefined) {
      const duplicate = await workflowNameExistsInFolder({
        workspaceId: params.workspaceId,
        name: targetName,
        folderId: targetFolderId,
        excludeWorkflowId: params.workflowId,
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
    if (params.color !== undefined) updateData.color = params.color
    if (params.folderId !== undefined) updateData.folderId = params.folderId
    if (params.sortOrder !== undefined) updateData.sortOrder = params.sortOrder
    if (params.locked !== undefined) updateData.locked = params.locked

    const [updatedWorkflow] = await db
      .update(workflow)
      .set(updateData)
      .where(eq(workflow.id, params.workflowId))
      .returning({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        color: workflow.color,
        workspaceId: workflow.workspaceId,
        folderId: workflow.folderId,
        sortOrder: workflow.sortOrder,
        locked: workflow.locked,
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
  } catch (error) {
    logger.error(`[${requestId}] Failed to update workflow ${params.workflowId}`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

/**
 * Performs a full workflow deletion: enforces the last-workflow guard,
 * handles published templates, archives the workflow via `archiveWorkflow`,
 * and records an audit entry. Both the workflow API DELETE handler and the
 * copilot delete_workflow tool must use this function.
 */
export async function performDeleteWorkflow(
  params: PerformDeleteWorkflowParams
): Promise<PerformDeleteWorkflowResult> {
  const { workflowId, userId, templateAction = 'orphan', skipLastWorkflowGuard = false } = params
  const actorId = params.actorId ?? userId
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

  try {
    const publishedTemplates = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.workflowId, workflowId))

    if (publishedTemplates.length > 0) {
      if (templateAction === 'delete') {
        await db.delete(templates).where(eq(templates.workflowId, workflowId))
        logger.info(
          `[${requestId}] Deleted ${publishedTemplates.length} templates for workflow ${workflowId}`
        )
      } else {
        await db
          .update(templates)
          .set({ workflowId: null })
          .where(eq(templates.workflowId, workflowId))
        logger.info(
          `[${requestId}] Orphaned ${publishedTemplates.length} templates for workflow ${workflowId}`
        )
      }
    }
  } catch (templateError) {
    logger.warn(`[${requestId}] Failed to handle templates for workflow ${workflowId}`, {
      error: templateError,
    })
  }

  const archiveResult = await archiveWorkflow(workflowId, { requestId })
  if (!archiveResult.workflow) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  logger.info(`[${requestId}] Successfully archived workflow ${workflowId}`)

  recordAudit({
    workspaceId: workflowRecord.workspaceId || null,
    actorId: actorId,
    action: AuditAction.WORKFLOW_DELETED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: workflowRecord.name,
    description: `Archived workflow "${workflowRecord.name}"`,
    metadata: {
      archived: archiveResult.archived,
      templateAction,
    },
  })

  return { success: true }
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
