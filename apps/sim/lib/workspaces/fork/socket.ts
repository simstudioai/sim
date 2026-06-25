import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('WorkspaceForkSocket')

/**
 * Best-effort notify connected canvas clients that a workflow was force-replaced
 * by a fork promote/rollback so they refresh instead of clobbering the new state.
 * Non-fatal: a failed notification never blocks the operation.
 */
export async function notifyForkWorkflowChanged(workflowId: string): Promise<void> {
  try {
    await fetch(`${getSocketServerUrl()}/api/workflow-deployed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workflowId }),
    })
  } catch (error) {
    logger.warn('Fork sync socket notification failed', { workflowId, error })
  }
}
