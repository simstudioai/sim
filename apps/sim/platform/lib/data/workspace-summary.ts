'use client'

import { useWorkspacesQuery } from '@/hooks/queries/workspace'

/** What a live workspace page needs for its heading, and how the read stands. */
export function useLiveWorkspace(workspaceId: string) {
  const query = useWorkspacesQuery()
  const found = query.data?.find((workspace) => workspace.id === workspaceId)
  return {
    status: query.status,
    /** `undefined` while loading, or when this viewer has no access to the workspace. */
    workspace: found && { id: found.id, name: found.name },
    missing: query.status === 'success' && !found,
    retry: () => void query.refetch(),
  }
}
