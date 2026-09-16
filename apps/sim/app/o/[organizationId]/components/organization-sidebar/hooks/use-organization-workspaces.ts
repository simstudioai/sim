import {
  EMPTY_PINNED_WORKSPACE_IDS,
  usePinnedWorkspaceIds,
  useWorkspacesQuery,
} from '@/hooks/queries/workspace'
import { useWorkspaceOrder } from '@/hooks/use-workspace-order'

/**
 * The organization's workspaces the viewer belongs to, for the sidebar's
 * Workspaces section. Read from the viewer's workspace list — the same query the
 * workspace switcher uses — narrowed to those the organization owns.
 */
export function useOrganizationWorkspaces(organizationId: string) {
  const { data = [], isLoading } = useWorkspacesQuery()
  const { data: pinnedWorkspaceIds = EMPTY_PINNED_WORKSPACE_IDS } = usePinnedWorkspaceIds()
  const orderedWorkspaces = useWorkspaceOrder(data, pinnedWorkspaceIds)
  const workspaces = orderedWorkspaces.filter(
    (workspace) => workspace.organizationId === organizationId
  )

  return {
    workspaces,
    pinnedWorkspaceIds,
    isLoading,
  }
}
