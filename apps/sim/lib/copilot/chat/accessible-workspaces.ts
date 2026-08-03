import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('CopilotAccessibleWorkspaces')

export interface AccessibleWorkspace {
  id: string
  name: string
  permission: PermissionType
}

/**
 * Returns active workspaces visible to the current user for informational
 * agent context. This data never replaces workspace authorization checks.
 */
export async function getAccessibleWorkspacesForCopilot(
  userId: string
): Promise<AccessibleWorkspace[]> {
  try {
    const rows = await listAccessibleWorkspaceRowsForUser(userId)
    return rows
      .map(({ workspace, permissionType }) => ({
        id: workspace.id,
        name: workspace.name,
        permission: permissionType,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'))
  } catch (error) {
    logger.warn('Failed to load accessible workspaces for copilot context', {
      userId,
      error: getErrorMessage(error),
    })
    return []
  }
}
