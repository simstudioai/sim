import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowSocketOperations')

async function resolveUserId(): Promise<string> {
  try {
    const sessionResult = await client.getSession()
    const userId = sessionResult.data?.user?.id
    if (userId) {
      return userId
    }
  } catch (error) {
    logger.warn('Failed to resolve session user id for workflow operation', { error })
  }

  return 'unknown'
}

interface EnqueueWorkflowOperationArgs {
  operation: string
  target: string
  payload: any
  workflowId: string
  immediate?: boolean
  operationId?: string
}

/**
 * Queues a workflow socket operation so it flows through the standard operation queue,
 * ensuring consistent retries, confirmations, and telemetry.
 */
export async function enqueueWorkflowOperation({
  operation,
  target,
  payload,
  workflowId,
  immediate = false,
  operationId,
}: EnqueueWorkflowOperationArgs): Promise<string> {
  const userId = await resolveUserId()
  const opId = operationId ?? crypto.randomUUID()

  useOperationQueueStore.getState().addToQueue({
    id: opId,
    operation: {
      operation,
      target,
      payload,
    },
    workflowId,
    userId,
    immediate,
  })

  logger.debug('Queued workflow operation', {
    workflowId,
    operation,
    target,
    operationId: opId,
    immediate,
  })

  return opId
}

interface EnqueueReplaceStateArgs {
  workflowId: string
  state: WorkflowState
  immediate?: boolean
  operationId?: string
}

/**
 * Convenience wrapper for broadcasting a full workflow state replacement via the queue.
 */
export async function enqueueReplaceWorkflowState({
  workflowId,
  state,
  immediate,
  operationId,
}: EnqueueReplaceStateArgs): Promise<string> {
  return enqueueWorkflowOperation({
    workflowId,
    operation: 'replace-state',
    target: 'workflow',
    payload: { state },
    immediate,
    operationId,
  })
}
