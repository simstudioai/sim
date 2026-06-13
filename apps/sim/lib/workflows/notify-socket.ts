import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('NotifyWorkflowSocket')

/**
 * Notifies the realtime socket server that a workflow's persisted state changed
 * out-of-band (e.g. a server-side copilot mutation), so connected editors refetch
 * instead of showing stale canvas state. Fire-and-forget: failures are logged, not
 * thrown, since the persisted change has already succeeded.
 */
export function notifyWorkflowUpdated(workflowId: string): void {
  fetch(`${getSocketServerUrl()}/api/workflow-updated`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.INTERNAL_API_SECRET,
    },
    body: JSON.stringify({ workflowId }),
  }).catch((error) => {
    logger.warn('Failed to notify socket server of workflow update', { workflowId, error })
  })
}
