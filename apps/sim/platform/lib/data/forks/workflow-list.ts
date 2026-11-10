'use client'

import { useQuery } from '@tanstack/react-query'
import { keepPreviousDataWithin } from '@/hooks/queries/utils/placeholder'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'

/**
 * The workspace's active workflows under `useWorkflows`' key, options and placeholder, read through
 * the list's query options and a placeholder that never crosses workspaces, because `useWorkflows` also reaches the editor stores the canvas owns.
 * Sharing the key keeps `useUpdateForkSyncedWorkflows`' optimistic patch on what this renders.
 */
export function useWorkspaceWorkflowList(workspaceId: string) {
  return useQuery({
    ...getWorkflowListQueryOptions(workspaceId),
    placeholderData: keepPreviousDataWithin(workflowKeys.workspaceLists(workspaceId)),
  })
}
