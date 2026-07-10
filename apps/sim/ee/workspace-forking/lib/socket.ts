import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('WorkspaceForkSocket')

async function postToRealtime(path: string, workflowId: string): Promise<void> {
  const response = await fetch(`${getSocketServerUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
    body: JSON.stringify({ workflowId }),
  })
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`)
  }
}

/**
 * Notify connected canvas clients that a fork promote/rollback force-replaced a
 * workflow's state. This mirrors a mothership edit rather than a passive ping:
 *
 * - `workflow-updated` makes each client reload the workflow from the API the same
 *   way it reacts to an external full-state edit (copilot / state route), deferring
 *   while a local diff or unsaved operations are pending so it never clobbers
 *   in-flight work. Without this the canvas keeps the stale state and a later local
 *   edit would overwrite the freshly-synced state.
 * - `workflow-deployed` refreshes the deployment indicator (the promote/rollback also
 *   changed which version is deployed).
 *
 * Best-effort and independent: each notification is attempted regardless of the
 * other, and a failure only warns - it never blocks the promote/rollback.
 */
export async function notifyForkWorkflowChanged(workflowId: string): Promise<void> {
  const results = await Promise.allSettled([
    postToRealtime('/api/workflow-updated', workflowId),
    postToRealtime('/api/workflow-deployed', workflowId),
  ])
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn('Fork sync socket notification failed', { workflowId, error: result.reason })
    }
  }
}
