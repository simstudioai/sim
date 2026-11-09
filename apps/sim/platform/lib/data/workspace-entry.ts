import 'server-only'
import { createLogger } from '@sim/logger'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import {
  listWorkspacesContract,
  type WorkspaceCreationPolicy,
} from '@/lib/api/contracts/workspaces'
import { isUpgradeReason, UPGRADE_REASON_PARAM } from '@/lib/billing/upgrade-reasons'
import { resolveLiveLanding } from '@/platform/lib/data/landing'
import { serverRequestJson } from '@/platform/lib/data/server-request'
import { workspaceEntry, workspacePath } from '@/platform/lib/workspace-navigation'

const logger = createLogger('PlatformWorkspaceEntry')

/** The `/workspace` query the legacy entry honored: a workflow to open, or a page to land on. */
export interface WorkspaceEntryQuery {
  redirectWorkflow: string | null
  redirect: string | null
  reason: string | null
}

/**
 * What the bare `/workspace` URL does for a viewer: open their last workspace (or a requested
 * workflow), hand off to the organization when they have no workspace of their own, explain why one
 * cannot be created, or create their first.
 */
export type WorkspaceEntryDecision =
  | { kind: 'redirect'; href: string }
  | { kind: 'blocked'; policy: WorkspaceCreationPolicy }
  | { kind: 'create' }
  | { kind: 'failed' }

/** Where a workspace opens for the query: its upgrade or settings page, or its home tab. */
function workspaceDestination(workspaceId: string, query: WorkspaceEntryQuery): string {
  if (query.redirect === 'upgrade') {
    const path = workspacePath(workspaceId, 'upgrade')
    return isUpgradeReason(query.reason) ? `${path}?${UPGRADE_REASON_PARAM}=${query.reason}` : path
  }
  if (query.redirect === 'settings') return workspacePath(workspaceId, 'settings')
  return workspaceEntry(workspaceId)
}

/** The legacy entry's workflow redirect: the workflow's own workspace, or the fallback. */
async function workflowDestination(workflowId: string, fallbackWorkspaceId: string) {
  try {
    const { data } = await serverRequestJson(getWorkflowStateContract, {
      params: { id: workflowId },
    })
    if (data.workspaceId) {
      return `${workspacePath(data.workspaceId, 'workflows')}/${encodeURIComponent(workflowId)}`
    }
  } catch (error) {
    logger.error('Could not resolve the workflow to open', { workflowId, error })
  }
  return workspaceEntry(fallbackWorkspaceId)
}

export async function resolveWorkspaceEntry(
  query: WorkspaceEntryQuery
): Promise<WorkspaceEntryDecision> {
  const list = await serverRequestJson(listWorkspacesContract, {
    query: { scope: 'active' },
  }).catch((error: unknown) => {
    logger.error('Could not read the viewer’s workspaces', { error })
    return null
  })
  if (!list) return { kind: 'failed' }
  const { workspaces, lastActiveWorkspaceId, creationPolicy, forwardOrganizationId } = list
  const target =
    workspaces.find((workspace) => workspace.id === lastActiveWorkspaceId) ?? workspaces[0]
  if (target) {
    return {
      kind: 'redirect',
      href: query.redirectWorkflow
        ? await workflowDestination(query.redirectWorkflow, target.id)
        : workspaceDestination(target.id, query),
    }
  }
  if (forwardOrganizationId) {
    return {
      kind: 'redirect',
      href: query.redirect === 'settings' ? '/settings' : await resolveLiveLanding(),
    }
  }
  if (creationPolicy && !creationPolicy.canCreate)
    return { kind: 'blocked', policy: creationPolicy }
  return { kind: 'create' }
}
