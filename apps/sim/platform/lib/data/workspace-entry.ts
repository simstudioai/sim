import 'server-only'
import { createLogger } from '@sim/logger'
import {
  listWorkspacesContract,
  type WorkspaceCreationPolicy,
} from '@/lib/api/contracts/workspaces'
import { isUpgradeReason, UPGRADE_REASON_PARAM } from '@/lib/billing/upgrade-reasons'
import { workspaceEntry, workspacePath } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'
import { listViewerWorkspaces } from '@/lib/workspaces/application/viewer-workspaces'
import { blockedWorkspaceEntryHref } from '@/platform/lib/data/route-resolution'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

const logger = createLogger('PlatformWorkspaceEntry')

/** The `/workspace` query the legacy entry honored: a workflow to open, or a page to land on. */
export interface WorkspaceEntryQuery {
  redirectWorkflow: string | null
  redirect: string | null
  reason: string | null
}

/**
 * What the bare `/workspace` URL does for a viewer: open their last workspace (or a requested
 * workflow), created first when they have none, hand off to the organization when they cannot
 * create one, or explain why.
 */
export type WorkspaceEntryDecision =
  | { kind: 'redirect'; href: string }
  | { kind: 'blocked'; policy: WorkspaceCreationPolicy }
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
    const { principal } = await requireSessionViewer()
    const { workspaceId } = await readWorkflowDefinition.execute({
      principal,
      input: { workflowId, state: 'draft' },
    })
    return `${workspacePath(workspaceId, 'workflows')}/${encodeURIComponent(workflowId)}`
  } catch (error) {
    logger.error('Could not resolve the workflow to open', { workflowId, error })
  }
  return workspaceEntry(fallbackWorkspaceId)
}

export async function resolveWorkspaceEntry(
  query: WorkspaceEntryQuery
): Promise<WorkspaceEntryDecision> {
  const { principal, activeOrganizationId } = await requireSessionViewer()
  /** No shell names an organization here, so the list decides in the viewer's landing one. */
  const list = await listViewerWorkspaces
    .execute({ principal, input: { scope: 'active' } })
    .then((payload) => asRouteResponse(listWorkspacesContract, payload))
    .catch((error: unknown) => {
      logger.error('Could not read the viewer’s workspaces', { error })
      return null
    })
  if (!list) return { kind: 'failed' }
  const { workspaces, lastActiveWorkspaceId, creationPolicy } = list
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
  if (creationPolicy && !creationPolicy.canCreate) {
    const href = await resolveForwardHref(principal.userId, activeOrganizationId, query)
    if (href) return { kind: 'redirect', href }
    return { kind: 'blocked', policy: creationPolicy }
  }
  return { kind: 'failed' }
}

/**
 * Where a viewer who cannot create a workspace is handed: the first page they have in the
 * organization the workspace list route picks for them. A failed lookup leaves them on the blocked
 * explanation, as it does there, and so does an organization with nothing of theirs.
 */
async function resolveForwardHref(
  userId: string,
  activeOrganizationId: string | null,
  query: WorkspaceEntryQuery
): Promise<string | null> {
  let organizationId: string | null
  try {
    organizationId = await resolveOrganizationLanding(userId, activeOrganizationId)
  } catch (error) {
    logger.warn('Could not resolve an organization to forward a blocked viewer to', { error })
    return null
  }
  if (!organizationId) return null
  const surface = await readOrganizationSurface(organizationId)
  if (surface.status !== 'ok') return null
  return blockedWorkspaceEntryHref(surface.organization, query.redirect)
}
