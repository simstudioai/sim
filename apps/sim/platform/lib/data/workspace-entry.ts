import 'server-only'
import { createLogger } from '@sim/logger'
import {
  listWorkspacesContract,
  type WorkspaceCreationPolicy,
} from '@/lib/api/contracts/workspaces'
import { isUpgradeReason, UPGRADE_REASON_PARAM } from '@/lib/billing/upgrade-reasons'
import { workspaceEntry, workspacePath } from '@/lib/navigation/paths'
import { resolveRolledOutOrganizationId } from '@/lib/navigation/resolve-app-entry'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { resolveOrganizationGate } from '@/platform/lib/data/route-resolution'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import { readShellOrganizationId } from '@/platform/lib/data/shell-scope'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import { DEFAULT_WORKSPACE_SETTING } from '@/platform/lib/data/workspace-settings'

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
  if (query.redirect === 'settings')
    return workspacePath(workspaceId, `settings/${DEFAULT_WORKSPACE_SETTING}`)
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
  /** The shell's organization, provisioned for an account in none, before the list decides. */
  await readShellOrganizationId()
  const list = await listWorkspacesForViewer({
    userId: principal.userId,
    activeOrganizationId,
    scope: 'active',
  })
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
    const forwardOrganizationId = await resolveForwardOrganizationId(
      principal.userId,
      activeOrganizationId
    )
    if (forwardOrganizationId) {
      // The organization's own root picks the first page the viewer has there.
      const scope = { routePrefix: `/o/${forwardOrganizationId}` }
      return {
        kind: 'redirect',
        href: surfaceHref(scope, query.redirect === 'settings' ? '/settings' : ''),
      }
    }
    return { kind: 'blocked', policy: creationPolicy }
  }
  return { kind: 'create' }
}

/**
 * The organization a viewer who cannot create a workspace is handed to, as the workspace list route
 * decides it. A failed lookup leaves them on the blocked explanation, as it does there, and so does
 * an organization with nothing of theirs: its gate would send them straight back here.
 */
async function resolveForwardOrganizationId(
  userId: string,
  activeOrganizationId: string | null
): Promise<string | null> {
  const session = { user: { id: userId }, session: { activeOrganizationId } }
  let organizationId: string | null
  try {
    organizationId = await resolveRolledOutOrganizationId(session)
  } catch (error) {
    logger.warn('Could not resolve an organization to forward a blocked viewer to', { error })
    return null
  }
  if (!organizationId) return null
  const surface = await readOrganizationSurface(organizationId)
  if (surface.status !== 'ok' || resolveOrganizationGate(surface.organization)) return null
  return organizationId
}
