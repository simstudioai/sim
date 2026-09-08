import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/**
 * The organization's workspaces the viewer belongs to, for the sidebar's
 * Workspaces section. Read from the viewer's workspace list — the same query the
 * workspace switcher uses — narrowed to those the organization owns.
 */
export function useOrganizationWorkspaces(organizationId: string) {
  const { data = [], isLoading } = useWorkspacesQuery()

  const workspaces = data.filter((workspace) => workspace.organizationId === organizationId)

  return { workspaces, isLoading }
}
