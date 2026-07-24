import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('RealtimeNotify')

/** Bound the wait on the realtime server so a slow/hung socket pod can't stall a file mutation. */
const NOTIFY_TIMEOUT_MS = 2000

/**
 * Best-effort fan-out to the realtime server that a workspace's file tree changed,
 * so every browser currently viewing that workspace's files refetches. File
 * mutations happen over the HTTP API (not the socket); this is the lossy liveness
 * signal — a dropped notification only degrades to stale-until-refetch, so it must
 * never throw or block the originating mutation.
 */
export async function notifyWorkspaceFilesChanged(workspaceId: string): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/workspace-files-changed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
      body: JSON.stringify({ workspaceId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn('workspace-files-changed notify failed', {
        workspaceId,
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('workspace-files-changed notify error', {
      workspaceId,
      error: getErrorMessage(error),
    })
  }
}
