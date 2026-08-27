import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
  type WorkflowWorkspaceAuthorizationResult,
} from '@sim/platform-authz/workflow'
import type { z } from 'zod'
import {
  type WorkflowStateContractOutput,
  workflowStateSchema,
} from '@/lib/api/contracts/workflows'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import {
  replaceWorkflowNormalizedState,
  WorkflowStatePersistenceError,
} from '@/lib/workflows/persistence/replace-normalized-state'
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
 * The legacy session-authenticated door to a graph replace, kept for the
 * internal editor route.
 *
 * It authorizes by bare `userId`, checks mutability, delegates the write to
 * {@link replaceWorkflowNormalizedState} — the one persistence primitive every
 * surface shares — and notifies the realtime server. Every refusal, the lock
 * included, comes back as a failure result so callers need one branch.
 *
 * New surfaces do **not** call this: a `userId` cannot express a workspace-key
 * or delegated principal. They go through `replaceWorkflowState`, which
 * authorizes as an application operation and records semantic audit.
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

  let warnings: string[]
  try {
    const saved = await replaceWorkflowNormalizedState({
      requestId,
      workflowId,
      workspaceId: workflowData.workspaceId ?? null,
      attributedUserId: userId,
      state: {
        blocks: state.blocks as Record<string, BlockState>,
        edges: state.edges as WorkflowState['edges'],
        variables: state.variables,
        lastSaved: state.lastSaved,
        isDeployed: state.isDeployed,
        deployedAt: state.deployedAt,
      },
    })
    warnings = saved.warnings
  } catch (error) {
    if (error instanceof WorkflowStatePersistenceError) {
      return {
        success: false,
        status: 500,
        error: 'Failed to save workflow state',
        details: error.detail,
      }
    }
    /**
     * The shared write classifies its own caller-fixable refusals — a graph id
     * another workflow already owns is a `conflict`, a workflow archived since
     * the authorization check is a `not_found`. Reading them here is what keeps
     * this door's statuses identical to the ones `replaceWorkflowState` returns
     * for the same refusal, rather than collapsing them into the caller's
     * generic 500. Read through the cause chain because the throw happens
     * inside the transaction callback, which drizzle wraps.
     */
    const classified = asOrchestrationError(error)
    if (classified) {
      return {
        success: false,
        status: statusForOrchestrationError(classified.code),
        error: messageForOrchestrationError(
          { error: classified.message, errorCode: classified.code },
          'Failed to save workflow state'
        ),
      }
    }
    throw error
  }

  await notifyWorkflowUpdated(workflowId)

  return { success: true, warnings }
}
