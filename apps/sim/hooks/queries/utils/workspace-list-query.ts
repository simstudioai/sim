import type { Workspace, WorkspacesResponse } from '@/lib/api/contracts'

export const WORKSPACE_LIST_STALE_TIME = 30 * 1000

/**
 * Applies cached-shape defaults to a single schema-parsed wire workspace —
 * only the invite fields are optional on the wire; everything else is
 * guaranteed by the contract schema.
 */
export function normalizeWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    inviteMembersEnabled: workspace.inviteMembersEnabled ?? false,
    inviteDisabledReason: workspace.inviteDisabledReason ?? null,
    inviteUpgradeRequired: workspace.inviteUpgradeRequired ?? false,
  }
}

/**
 * Normalizes the schema-parsed /api/workspaces payload into the cached shape.
 * Shared by the client workspace-list fetch and the workspace layout's
 * server-side sidebar prefetch so the two can never cache different shapes
 * under `workspaceKeys.list`.
 */
export function normalizeWorkspacesResponse(data: WorkspacesResponse): WorkspacesResponse {
  return { ...data, workspaces: data.workspaces.map(normalizeWorkspace) }
}
