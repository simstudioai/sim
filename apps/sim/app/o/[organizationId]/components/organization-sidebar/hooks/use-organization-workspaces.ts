import { useMemo } from 'react'
import { useWorkspacesQuery, type Workspace } from '@/hooks/queries/workspace'

/** Stable identity while the list loads, so the section's memos don't churn. */
const EMPTY_WORKSPACES: Workspace[] = []

/**
 * The organization's workspaces the viewer belongs to, for the sidebar's
 * Workspaces section. Read from the viewer's workspace list — the same query the
 * workspace switcher uses — narrowed to those the organization owns.
 */
export function useOrganizationWorkspaces(organizationId: string) {
  const { data = EMPTY_WORKSPACES, isLoading } = useWorkspacesQuery()

  const workspaces = useMemo(
    () => data.filter((workspace) => workspace.organizationId === organizationId),
    [data, organizationId]
  )

  return { workspaces, isLoading }
}
