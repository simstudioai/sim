import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('WorkspacePermissionsRealtime')

/**
 * Notifies the realtime server that a user's workspace permission changed so it
 * can reconcile any active workflow rooms — evicting the user where access was
 * revoked and refreshing their cached role where it was downgraded.
 *
 * Best-effort: failures are logged but never block the permission mutation, and
 * the realtime server independently re-validates cached roles on a short TTL.
 */
export async function notifyWorkspaceAccessChanged(
  workspaceId: string,
  userId: string
): Promise<void> {
  try {
    const response = await fetch(`${getSocketServerUrl()}/api/permissions-updated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workspaceId, userId }),
    })

    if (!response.ok) {
      logger.warn(
        `Failed to notify realtime of access change for user ${userId} in workspace ${workspaceId} (${response.status})`
      )
    }
  } catch (error) {
    logger.warn(
      `Error notifying realtime of access change for user ${userId} in workspace ${workspaceId}`,
      { error }
    )
  }
}
