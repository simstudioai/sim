import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
  type WorkflowWorkspaceAuthorizationResult,
} from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import {
  type WorkflowStateContractOutput,
  workflowStateSchema,
} from '@/lib/api/contracts/workflows'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowStatePersistence')

export type SaveWorkflowNormalizedStateResult =
  | { success: true; warnings: string[] }
  | { success: false; status: number; error: string; details?: string }

/**
 * Validates an untrusted state blob against the same schema `PUT /api/workflows/[id]/state`
 * applies, so in-process callers get the coercion and rejection the HTTP hop gave them.
 */
export function parseWorkflowStateForPersistence(
  value: unknown
): z.ZodSafeParseResult<WorkflowStateContractOutput> {
  return workflowStateSchema.safeParse(value)
}

/**
 * Writes a complete workflow state to the normalized tables: write authorization,
 * the lock check, block/edge preparation, the row-locked save transaction,
 * `lastSynced`/variables, custom-tool extraction, and the socket notification.
 * Every surface that replaces a workflow's state calls this, so no step can be
 * skipped by going through a different door.
 *
 * Every refusal, the lock included, comes back as a failure result — callers need
 * one branch.
 *
 * `authorization` lets a caller that already resolved the same decision hand it in
 * rather than pay for it twice; it must be the `write` decision for this workflow
 * and user.
 */
export async function saveWorkflowNormalizedState(params: {
  requestId: string
  workflowId: string
  userId: string
  state: WorkflowStateContractOutput
  authorization?: WorkflowWorkspaceAuthorizationResult
}): Promise<SaveWorkflowNormalizedStateResult> {
  const { requestId, workflowId, userId, state } = params

  const authorization =
    params.authorization ??
    (await authorizeWorkflowByWorkspacePermission({ workflowId, userId, action: 'write' }))
  const workflowData = authorization.workflow

  if (!workflowData) {
    logger.warn(`[${requestId}] Workflow ${workflowId} not found for state update`)
    return { success: false, status: 404, error: 'Workflow not found' }
  }

  if (!authorization.allowed) {
    logger.warn(
      `[${requestId}] User ${userId} denied permission to update workflow state ${workflowId}`
    )
    return {
      success: false,
      status: authorization.status || 403,
      error: authorization.message || 'Access denied',
    }
  }

  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      return { success: false, status: error.status, error: error.message }
    }
    throw error
  }

  const { state: preparedState, warnings: preparationWarnings } =
    prepareWorkflowStateForPersistence({
      blocks: state.blocks as Record<string, BlockState>,
      edges: state.edges as WorkflowState['edges'],
    })

  const workflowState = {
    ...preparedState,
    lastSaved: state.lastSaved || Date.now(),
    isDeployed: state.isDeployed || false,
    deployedAt: state.deployedAt,
  }

  const saveResult = await db.transaction(async (tx) => {
    await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
      .for('update')

    const result = await saveWorkflowToNormalizedTables(
      workflowId,
      workflowState as WorkflowState,
      tx
    )

    if (!result.success) return result

    const updateData: {
      lastSynced: Date
      updatedAt: Date
      variables?: typeof state.variables
    } = {
      lastSynced: new Date(),
      updatedAt: new Date(),
    }

    if (state.variables !== undefined) {
      updateData.variables = state.variables
    }

    await tx.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

    return result
  })

  if (!saveResult.success) {
    logger.error(`[${requestId}] Failed to save workflow ${workflowId} state:`, saveResult.error)
    return {
      success: false,
      status: 500,
      error: 'Failed to save workflow state',
      details: saveResult.error,
    }
  }

  try {
    const workspaceId = workflowData.workspaceId
    if (workspaceId) {
      const { saved, errors } = await extractAndPersistCustomTools(
        workflowState,
        workspaceId,
        userId
      )

      if (saved > 0) {
        logger.info(`[${requestId}] Persisted ${saved} custom tool(s) to database`, { workflowId })
      }

      if (errors.length > 0) {
        logger.warn(`[${requestId}] Some custom tools failed to persist`, { errors, workflowId })
      }
    } else {
      logger.warn(`[${requestId}] Workflow has no workspaceId, skipping custom tools persistence`, {
        workflowId,
      })
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to persist custom tools`, { error, workflowId })
  }

  await notifyWorkflowUpdated(workflowId)

  return { success: true, warnings: preparationWarnings }
}
