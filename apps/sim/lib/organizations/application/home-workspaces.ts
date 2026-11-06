import type { OrganizationHomeWorkspaceActivity } from '@/lib/api/contracts/organization-home'
import { defineAuthorizedOrganizationUseCase } from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { HOME_WORKSPACE_ACTIVITY_LIMIT } from '@/lib/organizations/home/limits'
import {
  readReviewAndLastRun,
  readRunningWorkflows,
} from '@/lib/organizations/home/workspace-activity'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

export const organizationHomeWorkspaceOperations = {
  // permission-group-exempt: governed by workspace access, like the log list; the group withholds fields inside a run, not the fact that it ran
  readActivity: defineOrganizationOperation({
    id: 'organization_home.workspace_activity.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const

/**
 * What each workspace the viewer can open is doing, across the same rows the sidebar lists. Being a
 * member of the organization opens nothing: the workspace access decides every row, and another
 * organization's workspace stays out even for a viewer who holds a grant on it.
 */
export const readOrganizationHomeWorkspaceActivity = defineAuthorizedOrganizationUseCase({
  operation: organizationHomeWorkspaceOperations.readActivity,
  async execute({ context }): Promise<OrganizationHomeWorkspaceActivity> {
    const accessible = await listAccessibleWorkspaceRowsForUser(
      context.userId,
      'active',
      context.organizationId
    )
    const workspaceIds = accessible
      .filter((row) => row.workspace.organizationId === context.organizationId)
      .slice(0, HOME_WORKSPACE_ACTIVITY_LIMIT)
      .map((row) => row.workspace.id)
    if (workspaceIds.length === 0) return { workspaces: [] }

    const [running, rows] = await Promise.all([
      readRunningWorkflows(workspaceIds, new Date()),
      readReviewAndLastRun(workspaceIds),
    ])
    const runningByWorkspace = new Map(running.map((row) => [row.workspaceId, row.workflowName]))
    return {
      workspaces: rows.map((row) => {
        const isRunning = runningByWorkspace.has(row.workspaceId)
        const isWaiting = row.waitingWorkflowName !== null
        return {
          workspaceId: row.workspaceId,
          status: isWaiting ? 'review' : isRunning ? 'running' : null,
          statusWorkflowName: isWaiting
            ? row.waitingWorkflowName
            : (runningByWorkspace.get(row.workspaceId) ?? null),
          lastRun: row.lastRunStartedAt
            ? {
                workflowName: row.lastRunWorkflowName,
                startedAt: row.lastRunStartedAt.toISOString(),
                failed: row.lastRunStatus === 'failed',
              }
            : null,
        }
      }),
    }
  },
})
